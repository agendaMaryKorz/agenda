# Agenda da Clínica

Site simples para controlar as sessões e os pagamentos de uma clínica de psicologia, integrado ao **Google Agenda**.

## O que ele faz

- **Agendamento**: cada sessão (paciente, data, horário, duração e valor) vira um evento no seu Google Agenda.
  Dá para criar sessões semanais repetidas (4, 8 ou 12 semanas) de uma vez.
- **Agenda (Dia, Mês e Ano)**:
  - **Dia**: todos os horários de atendimento, mostrando os **livres** (clique para agendar) e os **ocupados**
    com o nome do paciente e a situação do pagamento. Outros compromissos do Google Agenda também aparecem como ocupados.
  - **Mês**: calendário com os pacientes de cada dia e quantos horários ainda estão livres. Clique no dia para abri-lo.
  - **Ano**: os 12 meses, com os dias mais cheios em cor mais forte e o total de sessões e recebido em cada mês.
  - O horário de atendimento (início, fim, intervalo e dias da semana) é ajustado em `config.js`.
- **Pagamento**: uma caixinha "Pago?" em cada sessão. A data do pagamento fica registrada.
  No Google Agenda o evento fica **verde** quando está pago e **laranja** quando está em aberto.
- **Resumo do mês**:
  - **Pago no mês**: tudo o que foi recebido no mês (pela data do pagamento).
  - **Vencido**: sessões que já aconteceram e não foram pagas (de todos os meses).
  - **A receber no mês**: sessões de hoje em diante ainda não pagas.
  - **Quem está devendo**: lista por paciente com quantidade de sessões, a mais antiga e o total devido,
    com botão para marcar tudo como pago.

Os dados ficam guardados nos próprios eventos do Google Agenda, então não há banco de dados nem servidor:
o que você marcar no computador aparece também no celular. Só os eventos criados pelo sistema são
considerados; os outros compromissos da agenda são ignorados.

Também existe um **modo local** (sem Google), útil para testar: os dados ficam salvos apenas no navegador.

## Como configurar o Google Agenda (uma vez só)

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/) e crie um projeto (ex.: "Agenda Clínica").
2. Em **APIs e serviços > Biblioteca**, procure **Google Calendar API** e clique em **Ativar**.
3. Em **APIs e serviços > Tela de consentimento OAuth** (ou "Google Auth Platform"):
   - Tipo de usuário: **Externo**.
   - Preencha o nome do app e o seu e-mail.
   - Em **Usuários de teste** (Público-alvo), adicione o e-mail da conta Google que vai usar o sistema.
4. Em **APIs e serviços > Credenciais > Criar credenciais > ID do cliente OAuth**:
   - Tipo de aplicativo: **Aplicativo da Web**.
   - Em **Origens JavaScript autorizadas**, adicione o endereço onde o site vai ficar, por exemplo:
     - `https://SEU-USUARIO.github.io` (se usar GitHub Pages)
     - `http://localhost:8000` (para testar no seu computador)
5. Copie o **ID do cliente** gerado e cole em `config.js`:

   ```js
   GOOGLE_CLIENT_ID: '1234567890-abc123.apps.googleusercontent.com',
   ```

Em `config.js` você também pode mudar a agenda usada (`CALENDAR_ID`), o valor padrão da sessão
e a duração padrão.

> Enquanto o app estiver em modo "Teste" no Google Cloud, o Google mostra um aviso de "app não verificado"
> no login. Basta clicar em **Continuar**. Para uso próprio da clínica isso é suficiente.

## Como colocar no ar

**Testar no computador:**

```bash
python3 -m http.server 8000
```

e abra <http://localhost:8000>.

**Publicar com GitHub Pages:** no repositório, vá em **Settings > Pages**, escolha a branch e a pasta `/ (root)`
e salve. O endereço gerado (ex.: `https://SEU-USUARIO.github.io/Teste/`) deve estar nas
"Origens JavaScript autorizadas" do passo 4 (só a parte `https://SEU-USUARIO.github.io`).

## Arquivos

- `index.html`: estrutura da página
- `styles.css`: aparência (com tema claro e escuro)
- `app.js`: lógica, integração com o Google Agenda e cálculo do resumo
- `config.js`: suas configurações
