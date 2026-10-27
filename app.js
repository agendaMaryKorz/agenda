(() => {
  'use strict';

  const CFG = Object.assign({
    GOOGLE_CLIENT_ID: '',
    CALENDAR_ID: 'primary',
    VALOR_PADRAO: 150,
    DURACAO_PADRAO_MIN: 50,
    MESES_HISTORICO: 24,
  }, window.APP_CONFIG || {});

  const APP_TAG = 'clinica-agenda';
  const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
  const COR_PAGO = '10';    // verde (Basil)
  const COR_ABERTO = '6';   // laranja (Tangerine)

  // ---------- utilidades ----------
  const $ = (sel) => document.querySelector(sel);
  const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtMoeda = (v) => moeda.format(v || 0);
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const fmtData = (d) => d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const fmtDataCurta = (s) => { const [a, m, d] = s.split('-'); return `${d}/${m}/${a}`; };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inicioDoMes = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
  const addMeses = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
  const hojeStr = () => ymd(new Date());

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 3500);
  }

  // Situação de uma sessão: pago, vencido (já passou e não pagou) ou aberto (ainda vai acontecer / hoje).
  function situacao(s) {
    if (s.pago) return 'pago';
    return ymd(s.inicio) < hojeStr() ? 'vencido' : 'aberto';
  }
  const ROTULO = { pago: 'Pago', vencido: 'Vencido', aberto: 'A receber' };

  // ---------- armazenamento: Google Agenda ----------
  const GoogleStore = {
    nome: 'Google Agenda',
    token: null,
    tokenClient: null,

    async init() {
      await new Promise((resolve) => {
        const espera = () => (window.google?.accounts?.oauth2 ? resolve() : setTimeout(espera, 100));
        espera();
      });
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CFG.GOOGLE_CLIENT_ID,
        scope: SCOPE,
        callback: () => {},
      });
    },

    pedirToken(prompt) {
      return new Promise((resolve, reject) => {
        this.tokenClient.callback = (resp) => {
          if (resp.error) return reject(new Error(resp.error_description || resp.error));
          this.token = resp.access_token;
          resolve();
        };
        this.tokenClient.error_callback = (err) => reject(new Error(err.message || err.type));
        this.tokenClient.requestAccessToken({ prompt });
      });
    },

    async login() {
      await this.pedirToken('');
    },

    logout() {
      if (this.token) google.accounts.oauth2.revoke(this.token, () => {});
      this.token = null;
    },

    async api(path, { method = 'GET', params, body } = {}, tentativa = 0) {
      const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CFG.CALENDAR_ID)}/events${path}`);
      if (params) Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.append(k, v));
      const resp = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (resp.status === 401 && tentativa === 0) {
        await this.pedirToken('');
        return this.api(path, { method, params, body }, 1);
      }
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Erro do Google Agenda (${resp.status}): ${txt.slice(0, 200)}`);
      }
      return resp.status === 204 ? null : resp.json();
    },

    deEvento(ev) {
      const p = ev.extendedProperties?.private || {};
      return {
        id: ev.id,
        paciente: p.paciente || (ev.summary || '').replace(/^Sessão\s*-\s*/, ''),
        inicio: new Date(ev.start.dateTime || ev.start.date),
        fim: new Date(ev.end.dateTime || ev.end.date),
        valor: Number(p.valor) || 0,
        pago: p.pago === 'sim',
        dataPagamento: p.dataPagamento || '',
        obs: ev.description || '',
        link: ev.htmlLink,
      };
    },

    paraEvento(s) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return {
        summary: `Sessão - ${s.paciente}`,
        description: s.obs || '',
        start: { dateTime: s.inicio.toISOString(), timeZone: tz },
        end: { dateTime: s.fim.toISOString(), timeZone: tz },
        colorId: s.pago ? COR_PAGO : COR_ABERTO,
        extendedProperties: {
          private: {
            app: APP_TAG,
            paciente: s.paciente,
            valor: String(s.valor),
            pago: s.pago ? 'sim' : 'nao',
            dataPagamento: s.dataPagamento || '',
          },
        },
      };
    },

    async listar(de, ate) {
      const itens = [];
      let pageToken;
      do {
        const r = await this.api('', {
          params: {
            timeMin: de.toISOString(),
            timeMax: ate.toISOString(),
            singleEvents: 'true',
            orderBy: 'startTime',
            maxResults: 2500,
            privateExtendedProperty: `app=${APP_TAG}`,
            pageToken,
          },
        });
        itens.push(...(r.items || []).filter((ev) => ev.status !== 'cancelled').map((ev) => this.deEvento(ev)));
        pageToken = r.nextPageToken;
      } while (pageToken);
      return itens;
    },

    async criar(s) { return this.deEvento(await this.api('', { method: 'POST', body: this.paraEvento(s) })); },
    async atualizar(s) { return this.deEvento(await this.api(`/${encodeURIComponent(s.id)}`, { method: 'PATCH', body: this.paraEvento(s) })); },
    async remover(id) { await this.api(`/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
  };

  // ---------- armazenamento: local (navegador) ----------
  const LocalStore = {
    nome: 'Modo local',
    chave: 'clinica-agenda-sessoes',
    async init() {},
    async login() {},
    logout() {},
    ler() {
      try {
        return JSON.parse(localStorage.getItem(this.chave) || '[]').map((s) => ({ ...s, inicio: new Date(s.inicio), fim: new Date(s.fim) }));
      } catch { return []; }
    },
    gravar(lista) { localStorage.setItem(this.chave, JSON.stringify(lista)); },
    async listar(de, ate) {
      return this.ler().filter((s) => s.inicio >= de && s.inicio < ate).sort((a, b) => a.inicio - b.inicio);
    },
    async criar(s) {
      const nova = { ...s, id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()) };
      this.gravar([...this.ler(), nova]);
      return nova;
    },
    async atualizar(s) {
      this.gravar(this.ler().map((x) => (x.id === s.id ? { ...s } : x)));
      return s;
    },
    async remover(id) { this.gravar(this.ler().filter((x) => x.id !== id)); },
  };

  // ---------- estado ----------
  const estado = {
    store: null,
    mes: inicioDoMes(new Date()),
    sessoes: [],   // todas as sessões carregadas (histórico + mês exibido)
  };

  // ---------- carregamento ----------
  async function carregar() {
    const hojeMes = inicioDoMes(new Date());
    const base = estado.mes < hojeMes ? estado.mes : hojeMes;
    const de = addMeses(base, -CFG.MESES_HISTORICO);
    const fimMesVisto = addMeses(estado.mes, 1);
    const fimHoje = addMeses(hojeMes, 1);
    const ate = fimMesVisto > fimHoje ? fimMesVisto : fimHoje;

    $('#carregando').hidden = false;
    try {
      estado.sessoes = await estado.store.listar(de, ate);
      render();
    } catch (e) {
      console.error(e);
      toast(e.message);
    } finally {
      $('#carregando').hidden = true;
    }
  }

  // ---------- renderização ----------
  function render() {
    const mesIni = estado.mes;
    const mesFim = addMeses(mesIni, 1);
    const mesChave = ymd(mesIni).slice(0, 7);
    const titulo = mesIni.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    $('#mes-titulo').textContent = titulo.charAt(0).toUpperCase() + titulo.slice(1);

    const doMes = estado.sessoes.filter((s) => s.inicio >= mesIni && s.inicio < mesFim);

    // Resumo
    const pagosNoMes = estado.sessoes.filter((s) => s.pago && (s.dataPagamento || ymd(s.inicio)).slice(0, 7) === mesChave);
    const vencidos = estado.sessoes.filter((s) => situacao(s) === 'vencido');
    const aReceber = doMes.filter((s) => situacao(s) === 'aberto');
    const soma = (l) => l.reduce((t, s) => t + s.valor, 0);
    const qtd = (n) => `${n} ${n === 1 ? 'sessão' : 'sessões'}`;

    $('#r-pago').textContent = fmtMoeda(soma(pagosNoMes));
    $('#r-pago-qtd').textContent = qtd(pagosNoMes.length);
    $('#r-vencido').textContent = fmtMoeda(soma(vencidos));
    $('#r-vencido-qtd').textContent = qtd(vencidos.length) + ' (todos os meses)';
    $('#r-receber').textContent = fmtMoeda(soma(aReceber));
    $('#r-receber-qtd').textContent = qtd(aReceber.length);
    $('#r-sessoes').textContent = doMes.length;
    $('#r-sessoes-valor').textContent = `${fmtMoeda(soma(doMes))} no total`;

    // Lista do mês (com filtros)
    const busca = $('#filtro-nome').value.trim().toLowerCase();
    const filtroStatus = $('#filtro-status').value;
    const visiveis = doMes.filter((s) =>
      (!busca || s.paciente.toLowerCase().includes(busca)) &&
      (!filtroStatus || situacao(s) === filtroStatus));

    $('#lista').innerHTML = visiveis.map((s) => {
      const st = situacao(s);
      return `<tr data-id="${esc(s.id)}">
        <td>${esc(fmtData(s.inicio))}</td>
        <td>${hm(s.inicio)}–${hm(s.fim)}</td>
        <td>${esc(s.paciente)}${s.obs ? ` <span title="${esc(s.obs)}">📝</span>` : ''}</td>
        <td class="num">${fmtMoeda(s.valor)}</td>
        <td><span class="status ${st}">${ROTULO[st]}</span>${s.pago && s.dataPagamento ? ` <small>${fmtDataCurta(s.dataPagamento)}</small>` : ''}</td>
        <td><input type="checkbox" data-acao="pago" ${s.pago ? 'checked' : ''} aria-label="Marcar como pago"></td>
        <td class="acoes-linha">
          ${s.link ? `<a href="${esc(s.link)}" target="_blank" rel="noopener">Agenda ↗</a>` : ''}
          <button class="btn mini" data-acao="editar">Editar</button>
          <button class="btn mini" data-acao="excluir">Excluir</button>
        </td>
      </tr>`;
    }).join('');
    $('#vazio').hidden = visiveis.length > 0;
    $('#vazio').textContent = doMes.length ? 'Nenhuma sessão corresponde ao filtro.' : 'Nenhuma sessão neste mês.';

    // Devedores
    const porPaciente = new Map();
    for (const s of vencidos) {
      const d = porPaciente.get(s.paciente) || { paciente: s.paciente, sessoes: [], total: 0 };
      d.sessoes.push(s);
      d.total += s.valor;
      porPaciente.set(s.paciente, d);
    }
    const devedores = [...porPaciente.values()].sort((a, b) => b.total - a.total);
    $('#devedores').innerHTML = devedores.map((d) => `<tr data-paciente="${esc(d.paciente)}">
        <td>${esc(d.paciente)}</td>
        <td class="num">${d.sessoes.length}</td>
        <td>${esc(ymd(d.sessoes[0].inicio).split('-').reverse().join('/'))}</td>
        <td class="num"><strong>${fmtMoeda(d.total)}</strong></td>
        <td class="acoes-linha"><button class="btn mini" data-acao="quitar">Marcar tudo como pago</button></td>
      </tr>`).join('');
    $('#sem-devedores').hidden = devedores.length > 0;

    // Sugestões de nomes de pacientes
    const nomes = [...new Set(estado.sessoes.map((s) => s.paciente))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    $('#pacientes').innerHTML = nomes.map((n) => `<option value="${esc(n)}">`).join('');
  }

  // ---------- ações ----------
  async function salvar(s) {
    const salvo = s.id ? await estado.store.atualizar(s) : await estado.store.criar(s);
    const i = estado.sessoes.findIndex((x) => x.id === salvo.id);
    if (i >= 0) estado.sessoes[i] = salvo; else estado.sessoes.push(salvo);
    estado.sessoes.sort((a, b) => a.inicio - b.inicio);
    return salvo;
  }

  async function marcarPago(s, pago) {
    await salvar({ ...s, pago, dataPagamento: pago ? (s.dataPagamento || hojeStr()) : '' });
  }

  function abrirForm(s) {
    const f = $('#form');
    f.reset();
    f.dataset.id = s?.id || '';
    $('#dlg-titulo').textContent = s ? 'Editar sessão' : 'Nova sessão';
    $('#campo-repetir').hidden = !!s;
    const hoje = new Date();
    const dataPadrao = estado.mes.getMonth() === hoje.getMonth() && estado.mes.getFullYear() === hoje.getFullYear() ? hoje : estado.mes;
    f.paciente.value = s?.paciente || '';
    f.data.value = s ? ymd(s.inicio) : ymd(dataPadrao);
    f.hora.value = s ? hm(s.inicio) : '09:00';
    f.duracao.value = s ? Math.round((s.fim - s.inicio) / 60000) : CFG.DURACAO_PADRAO_MIN;
    f.valor.value = s ? s.valor : CFG.VALOR_PADRAO;
    f.pago.checked = !!s?.pago;
    f.dataPagamento.value = s?.dataPagamento || '';
    f.obs.value = s?.obs || '';
    $('#dlg').showModal();
    f.paciente.focus();
  }

  async function enviarForm(ev) {
    ev.preventDefault();
    const f = ev.target;
    const inicio = new Date(`${f.data.value}T${f.hora.value}`);
    const duracao = Number(f.duracao.value) * 60000;
    const pago = f.pago.checked;
    const base = {
      id: f.dataset.id || undefined,
      paciente: f.paciente.value.trim(),
      valor: Number(f.valor.value),
      pago,
      dataPagamento: pago ? (f.dataPagamento.value || hojeStr()) : '',
      obs: f.obs.value.trim(),
    };
    if (base.id) {
      const atual = estado.sessoes.find((s) => s.id === base.id);
      if (atual?.link) base.link = atual.link;
    }
    const repeticoes = base.id ? 1 : Number(f.repetir.value);

    $('#dlg').close();
    $('#carregando').hidden = false;
    try {
      for (let i = 0; i < repeticoes; i++) {
        const ini = new Date(inicio);
        ini.setDate(ini.getDate() + 7 * i);
        // Em sessões repetidas, só a primeira herda o "pago".
        const extra = i === 0 ? {} : { pago: false, dataPagamento: '' };
        await salvar({ ...base, ...extra, inicio: ini, fim: new Date(ini.getTime() + duracao) });
      }
      toast(repeticoes > 1 ? `${repeticoes} sessões criadas.` : 'Sessão salva.');
    } catch (e) {
      console.error(e);
      toast(e.message);
    } finally {
      $('#carregando').hidden = true;
      render();
    }
  }

  async function acaoLista(ev) {
    const alvo = ev.target.closest('[data-acao]');
    if (!alvo) return;
    const id = alvo.closest('tr').dataset.id;
    const s = estado.sessoes.find((x) => x.id === id);
    if (!s) return;
    const acao = alvo.dataset.acao;
    try {
      if (acao === 'editar') return abrirForm(s);
      if (acao === 'pago') {
        alvo.disabled = true;
        await marcarPago(s, alvo.checked);
      }
      if (acao === 'excluir') {
        if (!confirm(`Excluir a sessão de ${s.paciente} em ${fmtData(s.inicio)}? Ela também será removida do Google Agenda.`)) return;
        await estado.store.remover(s.id);
        estado.sessoes = estado.sessoes.filter((x) => x.id !== s.id);
        toast('Sessão excluída.');
      }
    } catch (e) {
      console.error(e);
      toast(e.message);
    }
    render();
  }

  async function acaoDevedores(ev) {
    const alvo = ev.target.closest('[data-acao="quitar"]');
    if (!alvo) return;
    const nome = alvo.closest('tr').dataset.paciente;
    const lista = estado.sessoes.filter((s) => s.paciente === nome && situacao(s) === 'vencido');
    const total = lista.reduce((t, s) => t + s.valor, 0);
    if (!confirm(`Marcar ${lista.length} sessão(ões) de ${nome} como pagas hoje (${fmtMoeda(total)})?`)) return;
    $('#carregando').hidden = false;
    try {
      for (const s of lista) await marcarPago(s, true);
      toast('Pagamentos registrados.');
    } catch (e) {
      console.error(e);
      toast(e.message);
    } finally {
      $('#carregando').hidden = true;
      render();
    }
  }

  // ---------- inicialização ----------
  async function entrar(store) {
    try {
      await store.init();
      await store.login();
    } catch (e) {
      console.error(e);
      toast(`Não foi possível entrar: ${e.message}`);
      return;
    }
    estado.store = store;
    localStorage.setItem('clinica-agenda-modo', store === GoogleStore ? 'google' : 'local');
    $('#tela-login').hidden = true;
    $('#tela-app').hidden = false;
    $('#modo').textContent = store === GoogleStore ? `Conectado ao Google Agenda` : 'Modo local (sem Google)';
    carregar();
  }

  function sair() {
    estado.store?.logout();
    estado.store = null;
    estado.sessoes = [];
    localStorage.removeItem('clinica-agenda-modo');
    $('#tela-app').hidden = true;
    $('#tela-login').hidden = false;
  }

  function mudarMes(n) {
    estado.mes = n === 0 ? inicioDoMes(new Date()) : addMeses(estado.mes, n);
    carregar();
  }

  const temGoogle = !!CFG.GOOGLE_CLIENT_ID;
  $('#btn-google').disabled = !temGoogle;
  $('#aviso-config').hidden = temGoogle;
  $('#btn-google').addEventListener('click', () => entrar(GoogleStore));
  $('#btn-local').addEventListener('click', () => entrar(LocalStore));
  $('#btn-sair').addEventListener('click', sair);
  $('#btn-nova').addEventListener('click', () => abrirForm(null));
  $('#mes-anterior').addEventListener('click', () => mudarMes(-1));
  $('#mes-proximo').addEventListener('click', () => mudarMes(1));
  $('#mes-hoje').addEventListener('click', () => mudarMes(0));
  $('#dlg-cancelar').addEventListener('click', () => $('#dlg').close());
  $('#form').addEventListener('submit', enviarForm);
  $('#form').pago.addEventListener('change', (e) => {
    const f = $('#form');
    if (e.target.checked && !f.dataPagamento.value) f.dataPagamento.value = hojeStr();
  });
  $('#lista').addEventListener('click', acaoLista);
  $('#devedores').addEventListener('click', acaoDevedores);
  $('#filtro-nome').addEventListener('input', render);
  $('#filtro-status').addEventListener('change', render);

  // O modo local reabre direto; o Google exige um clique (o navegador bloqueia o popup de login automático).
  if (localStorage.getItem('clinica-agenda-modo') === 'local') entrar(LocalStore);
})();
