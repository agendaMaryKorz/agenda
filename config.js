// Configurações do sistema. Edite os valores abaixo.
window.APP_CONFIG = {
  // ID do cliente OAuth criado no Google Cloud Console (veja o README).
  // Exemplo: '1234567890-abc123.apps.googleusercontent.com'
  GOOGLE_CLIENT_ID: '419825303681-jea2tmqosjrtq7lmdlf2d9gulu1jvucb.apps.googleusercontent.com',

  // Agenda onde as sessões serão criadas. 'primary' = agenda principal da conta.
  // Para usar outra agenda, coloque o ID dela (Configurações da agenda > Integrar agenda).
  CALENDAR_ID: 'primary',

  // Valores sugeridos ao criar uma nova sessão.
  VALOR_PADRAO: 150,
  DURACAO_PADRAO_MIN: 50,

  // Horário de atendimento, usado para mostrar os horários livres.
  HORA_INICIO: '07:00',
  HORA_FIM: '22:00',
  INTERVALO_MIN: 60,   // de quanto em quanto tempo começa um horário (60 = 08:00, 09:00, 10:00...)

  // Dias de atendimento: 0 = domingo, 1 = segunda, 2 = terça, 3 = quarta, 4 = quinta, 5 = sexta, 6 = sábado.
  DIAS_ATENDIMENTO: [1, 2, 3, 4, 5],

  // Quantos meses para trás o sistema busca sessões (para calcular dívidas antigas).
  MESES_HISTORICO: 24,
};
