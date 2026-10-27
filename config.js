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

  // Quantos meses para trás o sistema busca sessões (para calcular dívidas antigas).
  MESES_HISTORICO: 24,
};
