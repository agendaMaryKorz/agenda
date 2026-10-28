(() => {
  'use strict';

  // Precisa ser igual à versão no index.html. Se o navegador misturar arquivos de versões diferentes
  // (guardados em cache), a página é recarregada uma vez para buscar tudo atualizado.
  const VERSAO = '2026.10.28-1';
  const CHAVE_RECARGA = 'clinica-agenda-recarga';
  const versaoPagina = document.querySelector('meta[name="app-versao"]')?.content;
  if (versaoPagina !== VERSAO) {
    let jaRecarregou = false;
    try {
      jaRecarregou = sessionStorage.getItem(CHAVE_RECARGA) === VERSAO;
      sessionStorage.setItem(CHAVE_RECARGA, VERSAO);
    } catch { /* sem sessionStorage: tenta recarregar mesmo assim */ }
    if (!jaRecarregou) {
      location.replace(`${location.pathname}?v=${Date.now()}`);
      return;
    }
    console.warn(`Versões diferentes: página ${versaoPagina}, app ${VERSAO}.`);
  } else if (/[?&]v=/.test(location.search)) {
    history.replaceState(null, '', location.pathname);
  }

  const CFG = Object.assign({
    GOOGLE_CLIENT_ID: '',
    CALENDAR_ID: 'primary',
    VALOR_PADRAO: 150,
    DURACAO_PADRAO_MIN: 50,
    MESES_HISTORICO: 24,
    HORA_INICIO: '08:00',
    HORA_FIM: '20:00',
    INTERVALO_MIN: 60,
    DIAS_ATENDIMENTO: [1, 2, 3, 4, 5],
    COBRANCA_PADRAO: 'dia',
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
  const inicioDoDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const maiuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const nomeMes = (d) => maiuscula(d.toLocaleDateString('pt-BR', { month: 'long' }));
  const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 3500);
  }

  // Cobrança: define quando o pagamento de cada sessão vence.
  const COBRANCAS = {
    dia: { nome: 'No dia da sessão', curto: 'No dia', dica: 'Vence no dia de cada sessão.' },
    mes: { nome: 'Antecipado – mês', curto: 'Antecipado (mês)', dica: 'Todas as sessões do mês vencem na 1ª sessão do paciente naquele mês.' },
    todos: { nome: 'Antecipado – todos os agendamentos', curto: 'Antecipado (pacote)', dica: 'Todas as sessões criadas juntas (com "Repetir") vencem na 1ª sessão.' },
    fim_mes: { nome: 'No fim do mês', curto: 'Fim do mês', dica: 'Vence no último dia do mês de cada sessão.' },
  };
  const cobrancaDe = (s) => (COBRANCAS[s.cobranca] ? s.cobranca : 'dia');

  // Grupo de sessões que vencem juntas (antecipados): mesmo paciente e mês, ou mesmo pacote.
  function grupoDe(s) {
    const c = cobrancaDe(s);
    if (c === 'mes') return `mes|${s.paciente}|${ymd(s.inicio).slice(0, 7)}`;
    if (c === 'todos') return `todos|${s.serie || s.id}`;
    return null;
  }

  // Primeira data de cada grupo antecipado; refeito a cada renderização.
  let inicioDosGrupos = new Map();
  function indexarGrupos() {
    inicioDosGrupos = new Map();
    for (const s of estado.sessoes) {
      const g = grupoDe(s);
      if (!g) continue;
      const d = ymd(s.inicio);
      if (!inicioDosGrupos.has(g) || d < inicioDosGrupos.get(g)) inicioDosGrupos.set(g, d);
    }
  }

  function vencimento(s) {
    const c = cobrancaDe(s);
    if (c === 'fim_mes') return ymd(new Date(s.inicio.getFullYear(), s.inicio.getMonth() + 1, 0));
    const g = grupoDe(s);
    return (g && inicioDosGrupos.get(g)) || ymd(s.inicio);
  }

  // Situação de uma sessão: pago, vencido (vencimento já passou e não pagou) ou aberto (a receber).
  function situacao(s) {
    if (s.pago) return 'pago';
    return vencimento(s) < hojeStr() ? 'vencido' : 'aberto';
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
        // O acesso do Google dura cerca de 1 hora; renova e tenta de novo.
        try {
          await this.pedirToken('');
        } catch (e) {
          throw new Error('A conexão com o Google expirou. Clique em "Sair" e depois em "Entrar com Google".');
        }
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
        cobranca: p.cobranca || 'dia',
        serie: p.serie || '',
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
            cobranca: s.cobranca || 'dia',
            serie: s.serie || '',
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

    // Eventos da agenda que não são sessões (consultas médicas, reuniões...), para mostrar como ocupados.
    async listarOutros(de, ate) {
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
            pageToken,
          },
        });
        for (const ev of r.items || []) {
          if (ev.status === 'cancelled' || ev.transparency === 'transparent') continue;
          if (ev.extendedProperties?.private?.app === APP_TAG) continue;
          const diaInteiro = !ev.start.dateTime;
          itens.push({
            titulo: ev.summary || '(sem título)',
            diaInteiro,
            inicio: diaInteiro ? new Date(`${ev.start.date}T00:00`) : new Date(ev.start.dateTime),
            fim: diaInteiro ? new Date(`${ev.end.date}T00:00`) : new Date(ev.end.dateTime),
            link: ev.htmlLink,
          });
        }
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
    async listarOutros() { return []; },
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
  const VISOES = ['dia', 'mes', 'ano'];
  const estado = {
    store: null,
    data: inicioDoDia(new Date()),  // dia selecionado; o mês e o ano exibidos derivam dele
    visao: VISOES.includes(localStorage.getItem('clinica-agenda-visao')) ? localStorage.getItem('clinica-agenda-visao') : 'dia',
    sessoes: [],   // todas as sessões carregadas (histórico + ano exibido)
    faixa: '',     // período já carregado em estado.sessoes
    outros: [],    // outros compromissos do período exibido (dia ou mês)
  };

  // ---------- carregamento ----------
  // Período dos outros compromissos, conforme a visão (no ano eles não são mostrados).
  function periodoOutros() {
    if (estado.visao === 'dia') return [estado.data, addDias(estado.data, 1)];
    if (estado.visao === 'mes') { const ini = inicioDoMes(estado.data); return [ini, addMeses(ini, 1)]; }
    return null;
  }

  async function carregar() {
    const hojeMes = inicioDoMes(new Date());
    const ano = estado.data.getFullYear();
    const inicioAno = new Date(ano, 0, 1);
    const fimAno = new Date(ano + 1, 0, 1);
    const de = addMeses(inicioAno < hojeMes ? inicioAno : hojeMes, -CFG.MESES_HISTORICO);
    const fimHoje = addMeses(hojeMes, 1);
    const ate = fimAno > fimHoje ? fimAno : fimHoje;
    const faixa = `${ymd(de)}|${ymd(ate)}`;
    const periodo = periodoOutros();

    $('#carregando').hidden = false;
    try {
      if (faixa !== estado.faixa) {
        estado.sessoes = (await estado.store.listar(de, ate)).sort((a, b) => a.inicio - b.inicio);
        estado.faixa = faixa;
      }
      estado.outros = periodo ? await estado.store.listarOutros(...periodo) : [];
    } catch (e) {
      console.error(e);
      toast(e.message);
    } finally {
      $('#carregando').hidden = true;
      render();
    }
  }

  // ---------- agenda: dia, mês e ano ----------
  const atende = (d) => CFG.DIAS_ATENDIMENTO.includes(d.getDay());

  function horariosDoDia(d) {
    const [hi, mi] = CFG.HORA_INICIO.split(':').map(Number);
    const [hf, mf] = CFG.HORA_FIM.split(':').map(Number);
    const passo = CFG.INTERVALO_MIN * 60000;
    const fim = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hf, mf).getTime();
    const lista = [];
    for (let t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hi, mi).getTime(); t + passo <= fim; t += passo) {
      lista.push({ inicio: new Date(t), fim: new Date(t + passo) });
    }
    return lista;
  }

  // Sessões e outros compromissos com horário que ocupam o dia, em ordem.
  function ocupacoesDoDia(d, porDia) {
    const ini = inicioDoDia(d);
    const fim = addDias(ini, 1);
    const sessoes = (porDia.get(ymd(d)) || []).map((s) => ({ tipo: 'sessao', inicio: s.inicio, fim: s.fim, s }));
    const outros = estado.outros
      .filter((o) => !o.diaInteiro && o.inicio < fim && o.fim > ini)
      .map((o) => ({ tipo: 'outro', inicio: o.inicio < ini ? ini : o.inicio, fim: o.fim > fim ? fim : o.fim, o }));
    return [...sessoes, ...outros].sort((a, b) => a.inicio - b.inicio);
  }

  function livresDoDia(d, ocupacoes) {
    if (!atende(d)) return [];
    return horariosDoDia(d).filter((h) => !ocupacoes.some((o) => o.inicio < h.fim && o.fim > h.inicio));
  }

  function sessoesPorDia() {
    const mapa = new Map();
    for (const s of estado.sessoes) {
      const k = ymd(s.inicio);
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(s);
    }
    return mapa;
  }

  function renderDia(porDia) {
    const d = estado.data;
    const ocupacoes = ocupacoesDoDia(d, porDia);
    const livres = livresDoDia(d, ocupacoes);
    const passou = (h) => h.fim <= new Date();
    const diaInteiro = estado.outros.filter((o) => o.diaInteiro && o.inicio <= d && o.fim > d);
    const qtdSessoes = ocupacoes.filter((o) => o.tipo === 'sessao').length;

    $('#agenda-info').textContent = `${qtdSessoes} ${qtdSessoes === 1 ? 'sessão' : 'sessões'} · ${livres.length} ${livres.length === 1 ? 'horário livre' : 'horários livres'}`;

    const linhas = [...ocupacoes, ...livres.map((h) => ({ tipo: 'livre', ...h }))].sort((a, b) => a.inicio - b.inicio);
    const html = linhas.map((l) => {
      const hora = `<span class="hora">${hm(l.inicio)}–${hm(l.fim)}</span>`;
      if (l.tipo === 'livre') {
        return `<button class="horario livre${passou(l) ? ' passado' : ''}" data-novo="${ymd(l.inicio)}T${hm(l.inicio)}">
          ${hora}<span class="nome">Livre</span><span class="dica">+ agendar</span></button>`;
      }
      if (l.tipo === 'outro') {
        return `<div class="horario outro">${hora}<span class="nome">${esc(l.o.titulo)}</span><span class="dica">Outro compromisso</span></div>`;
      }
      const st = situacao(l.s);
      return `<button class="horario ocupado st-${st}" data-id="${esc(l.s.id)}">
        ${hora}<span class="nome">${esc(l.s.paciente)}</span><span class="status ${st}">${ROTULO[st]}</span></button>`;
    }).join('');

    const avisos = [
      ...diaInteiro.map((o) => `<p class="aviso-dia">📌 Dia inteiro: ${esc(o.titulo)}</p>`),
      atende(d) ? '' : '<p class="aviso-dia">Sem atendimento neste dia da semana (ajuste em <code>config.js</code>).</p>',
    ].join('');
    $('#agenda').innerHTML = `${avisos}<div class="horarios">${html || '<p class="vazio">Nenhum horário neste dia.</p>'}</div>`;
  }

  function renderMes(porDia) {
    const iniMes = inicioDoMes(estado.data);
    const fimMes = addMeses(iniMes, 1);
    const hoje = hojeStr();
    const inicioGrade = addDias(iniMes, -iniMes.getDay());
    const fimGrade = addDias(fimMes, (7 - fimMes.getDay()) % 7);
    let totalLivres = 0;

    let celulas = '';
    for (let d = inicioGrade; d < fimGrade; d = addDias(d, 1)) {
      const k = ymd(d);
      const doMes = d >= iniMes && d < fimMes;
      const ocupacoes = ocupacoesDoDia(d, porDia);
      const livres = doMes && k >= hoje ? livresDoDia(d, ocupacoes).filter((h) => h.fim > new Date()) : [];
      totalLivres += livres.length;
      const diaInteiro = estado.outros.filter((o) => o.diaInteiro && o.inicio <= d && o.fim > d)
        .map((o) => `<li class="ev outro">📌 ${esc(o.titulo)}</li>`).join('');
      const itens = diaInteiro + ocupacoes.slice(0, 4).map((o) => o.tipo === 'sessao'
        ? `<li class="ev st-${situacao(o.s)}">${hm(o.inicio)} ${esc(o.s.paciente)}</li>`
        : `<li class="ev outro">${hm(o.inicio)} ${esc(o.o.titulo)}</li>`).join('');
      const mais = ocupacoes.length > 4 ? `<li class="mais">+${ocupacoes.length - 4} mais</li>` : '';
      celulas += `<button class="dia${doMes ? '' : ' fora'}${k === hoje ? ' hoje' : ''}${atende(d) ? '' : ' folga'}" data-dia="${k}">
        <span class="dia-num">${d.getDate()}</span>
        ${ocupacoes.length ? `<span class="dia-qtd">${ocupacoes.length}</span>` : ''}
        <ul>${itens}${mais}</ul>
        ${livres.length ? `<span class="dia-livres">${livres.length} ${livres.length === 1 ? 'livre' : 'livres'}</span>` : ''}
      </button>`;
    }
    $('#agenda-info').textContent = `${totalLivres} horários livres a partir de hoje · clique em um dia para ver os horários`;
    $('#agenda').innerHTML = `<div class="grade-mes">${SEMANA.map((s) => `<div class="semana">${s}</div>`).join('')}${celulas}</div>`;
  }

  function renderAno(porDia) {
    const ano = estado.data.getFullYear();
    const hoje = hojeStr();
    const nivel = (n) => (n === 0 ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : 3);
    let totalAno = 0;

    const meses = Array.from({ length: 12 }, (_, m) => {
      const ini = new Date(ano, m, 1);
      const fim = addMeses(ini, 1);
      const chave = ymd(ini).slice(0, 7);
      let dias = '<span></span>'.repeat(ini.getDay());
      let qtd = 0;
      for (let d = ini; d < fim; d = addDias(d, 1)) {
        const k = ymd(d);
        const n = (porDia.get(k) || []).length;
        qtd += n;
        dias += `<button class="mini-dia n${nivel(n)}${k === hoje ? ' hoje' : ''}" data-dia="${k}" title="${fmtDataCurta(k)}: ${n} ${n === 1 ? 'sessão' : 'sessões'}">${d.getDate()}</button>`;
      }
      totalAno += qtd;
      const recebido = estado.sessoes
        .filter((s) => s.pago && (s.dataPagamento || ymd(s.inicio)).slice(0, 7) === chave)
        .reduce((t, s) => t + s.valor, 0);
      return `<div class="mini-mes">
        <button class="mini-titulo" data-mes="${chave}">${nomeMes(ini)}</button>
        <div class="mini-grade">${SEMANA.map((s) => `<span class="mini-sem">${s[0]}</span>`).join('')}${dias}</div>
        <small>${qtd} ${qtd === 1 ? 'sessão' : 'sessões'} · ${fmtMoeda(recebido)} recebido</small>
      </div>`;
    }).join('');

    $('#agenda-info').textContent = `${totalAno} sessões no ano · quanto mais escuro o dia, mais sessões`;
    $('#agenda').innerHTML = `<div class="grade-ano">${meses}</div>`;
  }

  function renderAgenda() {
    const d = estado.data;
    const titulos = {
      dia: maiuscula(d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })),
      mes: `${nomeMes(d)} de ${d.getFullYear()}`,
      ano: String(d.getFullYear()),
    };
    $('#nav-titulo').textContent = titulos[estado.visao];
    $('#agenda-titulo').textContent = { dia: 'Horários do dia', mes: 'Agenda do mês', ano: 'Agenda do ano' }[estado.visao];
    document.querySelectorAll('.aba').forEach((b) => b.classList.toggle('ativa', b.dataset.visao === estado.visao));
    const porDia = sessoesPorDia();
    ({ dia: renderDia, mes: renderMes, ano: renderAno })[estado.visao](porDia);
  }

  function acaoAgenda(ev) {
    const novo = ev.target.closest('[data-novo]');
    if (novo) {
      const [data, hora] = novo.dataset.novo.split('T');
      return abrirForm(null, { data, hora });
    }
    const sessao = ev.target.closest('[data-id]');
    if (sessao) return abrirForm(estado.sessoes.find((s) => s.id === sessao.dataset.id));
    const mes = ev.target.closest('[data-mes]');
    if (mes) {
      const [a, m] = mes.dataset.mes.split('-').map(Number);
      return mudarVisao('mes', new Date(a, m - 1, 1));
    }
    const dia = ev.target.closest('[data-dia]');
    if (dia) mudarVisao('dia', new Date(`${dia.dataset.dia}T00:00`));
  }

  // ---------- renderização ----------
  function render() {
    indexarGrupos();
    renderAgenda();

    const mesIni = inicioDoMes(estado.data);
    const mesFim = addMeses(mesIni, 1);
    const mesChave = ymd(mesIni).slice(0, 7);
    $('#resumo-titulo').textContent = `Resumo de ${nomeMes(mesIni).toLowerCase()} de ${mesIni.getFullYear()}`;
    $('#lista-titulo').textContent = `Sessões de ${nomeMes(mesIni).toLowerCase()}`;

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
        <td>${fmtDataCurta(vencimento(s))}<br><small class="cobranca">${COBRANCAS[cobrancaDe(s)].curto}</small></td>
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

  function abrirForm(s, sugestao) {
    const f = $('#form');
    f.reset();
    f.dataset.id = s?.id || '';
    $('#dlg-titulo').textContent = s ? 'Editar sessão' : 'Nova sessão';
    document.querySelectorAll('.so-nova').forEach((el) => { el.hidden = !!s; });
    const hoje = new Date();
    const mes = inicioDoMes(estado.data);
    const mesmoMes = mes.getMonth() === hoje.getMonth() && mes.getFullYear() === hoje.getFullYear();
    const dataPadrao = estado.visao === 'dia' ? estado.data : mesmoMes ? hoje : mes;
    f.paciente.value = s?.paciente || '';
    f.data.value = s ? ymd(s.inicio) : sugestao?.data || ymd(dataPadrao);
    f.hora.value = s ? hm(s.inicio) : sugestao?.hora || CFG.HORA_INICIO;
    f.duracao.value = s ? Math.round((s.fim - s.inicio) / 60000) : CFG.DURACAO_PADRAO_MIN;
    f.valor.value = s ? s.valor : CFG.VALOR_PADRAO;
    f.pago.checked = !!s?.pago;
    f.dataPagamento.value = s?.dataPagamento || '';
    f.obs.value = s?.obs || '';
    f.cobranca.value = s ? cobrancaDe(s) : (COBRANCAS[CFG.COBRANCA_PADRAO] ? CFG.COBRANCA_PADRAO : 'dia');
    atualizarDicaCobranca();
    f.vezes.value = 4;
    atualizarRepeticao();
    $('#dlg').showModal();
    f.paciente.focus();
  }

  function atualizarDicaCobranca() {
    $('#cobranca-dica').textContent = COBRANCAS[$('#form').cobranca.value].dica;
  }

  // Paciente já cadastrado: sugere o valor e a cobrança usados na última sessão dele.
  function sugerirDoPaciente() {
    const f = $('#form');
    if (f.dataset.id) return;
    const nome = f.paciente.value.trim();
    const ultima = estado.sessoes.filter((s) => s.paciente === nome).at(-1);
    if (!ultima) return;
    f.valor.value = ultima.valor;
    f.cobranca.value = cobrancaDe(ultima);
    atualizarDicaCobranca();
  }

  // Data da i-ésima sessão de uma repetição (i = 0 é a primeira).
  function dataDaRepeticao(inicio, tipo, i) {
    if (tipo === 'mensal') {
      // Mesmo dia do mês; em meses mais curtos (ex.: dia 31), usa o último dia.
      const ultimoDia = new Date(inicio.getFullYear(), inicio.getMonth() + i + 1, 0).getDate();
      return new Date(inicio.getFullYear(), inicio.getMonth() + i, Math.min(inicio.getDate(), ultimoDia), inicio.getHours(), inicio.getMinutes());
    }
    const d = new Date(inicio);
    d.setDate(d.getDate() + (tipo === 'quinzenal' ? 14 : 7) * i);
    return d;
  }

  // Opções "semanal:4" já trazem a quantidade; quinzenal e mensal usam o campo "Quantas sessões".
  function lerRepeticao(f) {
    const [tipo, fixo] = f.repetir.value.split(':');
    return { tipo, fixo: !!fixo, vezes: tipo ? Number(fixo || f.vezes.value) : 1 };
  }

  function atualizarRepeticao() {
    const f = $('#form');
    const { tipo, fixo, vezes } = lerRepeticao(f);
    const novo = !f.dataset.id;
    $('#campo-vezes').hidden = !novo || !tipo || fixo;
    f.vezes.required = novo && !!tipo && !fixo;
    const resumo = $('#repetir-resumo');
    resumo.hidden = !novo || !tipo || !f.data.value || !(vezes >= 2);
    if (resumo.hidden) return;
    const inicio = new Date(`${f.data.value}T${f.hora.value || '00:00'}`);
    const ultima = dataDaRepeticao(inicio, tipo, vezes - 1);
    resumo.textContent = `Serão criadas ${vezes} sessões, de ${inicio.toLocaleDateString('pt-BR')} até ${ultima.toLocaleDateString('pt-BR')}.`;
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
      cobranca: f.cobranca.value,
      obs: f.obs.value.trim(),
    };
    if (base.id) {
      const atual = estado.sessoes.find((s) => s.id === base.id);
      if (atual?.link) base.link = atual.link;
      base.serie = atual?.serie || '';
    }
    const { tipo, vezes } = base.id ? { tipo: '', vezes: 1 } : lerRepeticao(f);
    const repeticoes = vezes;
    if (repeticoes > 1) base.serie = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

    $('#dlg').close();
    $('#carregando').hidden = false;
    try {
      for (let i = 0; i < repeticoes; i++) {
        const ini = dataDaRepeticao(inicio, tipo, i);
        // Nas repetições, o "pago" vale só para a 1ª sessão, exceto no antecipado:
        // pacote inteiro (todos) ou as sessões do mesmo mês da 1ª (mês).
        const pagoJunto = base.cobranca === 'todos' ||
          (base.cobranca === 'mes' && ini.getMonth() === inicio.getMonth() && ini.getFullYear() === inicio.getFullYear());
        const extra = i === 0 || pagoJunto ? {} : { pago: false, dataPagamento: '' };
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
        const g = alvo.checked ? grupoDe(s) : null;
        const outras = g ? estado.sessoes.filter((x) => x.id !== s.id && !x.pago && grupoDe(x) === g) : [];
        const qual = cobrancaDe(s) === 'mes' ? `de ${nomeMes(s.inicio).toLowerCase()}` : 'do mesmo pacote';
        const juntas = outras.length && confirm(
          `Pagamento antecipado: marcar também as outras ${outras.length} ${outras.length === 1 ? 'sessão' : 'sessões'} de ${s.paciente} ${qual} como pagas?\n\n` +
          `Total: ${fmtMoeda([s, ...outras].reduce((t, x) => t + x.valor, 0))}`);
        $('#carregando').hidden = false;
        try {
          for (const x of [s, ...(juntas ? outras : [])]) await marcarPago(x, alvo.checked);
        } finally {
          $('#carregando').hidden = true;
        }
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
    estado.faixa = '';
    localStorage.removeItem('clinica-agenda-modo');
    $('#tela-app').hidden = true;
    $('#tela-login').hidden = false;
  }

  function navegar(n) {
    const d = estado.data;
    if (n === 0) estado.data = inicioDoDia(new Date());
    else if (estado.visao === 'dia') estado.data = addDias(d, n);
    else if (estado.visao === 'mes') estado.data = addMeses(d, n);
    else estado.data = new Date(d.getFullYear() + n, d.getMonth(), 1);
    carregar();
  }

  function mudarVisao(visao, data) {
    estado.visao = visao;
    if (data) estado.data = data;
    localStorage.setItem('clinica-agenda-visao', visao);
    carregar();
  }

  const temGoogle = !!CFG.GOOGLE_CLIENT_ID;
  $('#btn-google').disabled = !temGoogle;
  $('#aviso-config').hidden = temGoogle;
  $('#btn-google').addEventListener('click', () => entrar(GoogleStore));
  $('#btn-local').addEventListener('click', () => entrar(LocalStore));
  $('#btn-sair').addEventListener('click', sair);
  $('#btn-nova').addEventListener('click', () => abrirForm(null));
  $('#nav-anterior').addEventListener('click', () => navegar(-1));
  $('#nav-proximo').addEventListener('click', () => navegar(1));
  $('#nav-hoje').addEventListener('click', () => navegar(0));
  document.querySelectorAll('.aba').forEach((b) => b.addEventListener('click', () => mudarVisao(b.dataset.visao)));
  $('#agenda').addEventListener('click', acaoAgenda);
  $('#dlg-cancelar').addEventListener('click', () => $('#dlg').close());
  $('#form').addEventListener('submit', enviarForm);
  $('#form').cobranca.addEventListener('change', atualizarDicaCobranca);
  $('#form').paciente.addEventListener('change', sugerirDoPaciente);
  ['repetir', 'vezes', 'data', 'hora'].forEach((n) => $('#form')[n].addEventListener('input', atualizarRepeticao));
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
