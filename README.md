# PagaAí 💸

Aplicação web para registrar gastos compartilhados, acompanhar parcelas e controlar pagamentos entre amigos. O MVP continua **single-player**: os dados financeiros permanecem no `localStorage` do navegador. O login Supabase está integrado, mas ainda não sincroniza despesas entre pessoas ou dispositivos.

## Requisitos

- Node.js 22.6 ou superior (necessário para executar a suíte de testes integrada)
- npm

## Executar localmente

```bash
npm install
npm run dev
```

Para o login, copie `.env.example` para `.env.local` e configure as variáveis no seu ambiente. Não versione `.env.local` nem compartilhe chaves secretas. Os amigos podem abrir o site publicado, mas cada navegador ainda mantém seus próprios dados locais.

Abra no navegador o endereço exibido pelo Vite. Para gerar a versão de produção:

```bash
npm run build
npm run preview
```

Para executar os testes das regras de parcelas, datas, centavos e migrações:

```bash
npm test
```

## Funcionalidades disponíveis

- Dashboard com valores a receber e recebidos, gráfico de rosca e filtro por mês/ano.
- Perfil “Eu” criado automaticamente e incluído por padrão nas novas despesas.
- Cadastro de amigos, chave Pix opcional e dependentes vinculados ao responsável.
- Cadastro de cartões com dia de fechamento e vencimento.
- Despesas pagas via Pix ou cartão, à vista ou parceladas em até 48 vezes.
- Divisão igualitária inicial, ajuste manual por participante e validação do total.
- Registro de uma divisão por participante em cada parcela e baixa individual de pagamentos.
- Edição e exclusão protegidas para preservar relações e pagamentos registrados.
- Gestão posterior de dependentes, histórico mensal pela data de pagamento e detalhamento das faturas por parcela.
- Exportação e restauração de backup JSON validado.
- Persistência no `localStorage` via Zustand. Não há backend, autenticação ou sincronização entre dispositivos.

Consulte [SPEC.md](./SPEC.md) para a especificação funcional, regras de cálculo, estrutura de dados e ideias para versões futuras.

## Publicação

O GitHub Actions compila e publica `dist/` no GitHub Pages a cada push em `main`. Para o repositório `paga-ai`, o endereço esperado é `https://<usuario>.github.io/paga-ai/`. Em **Settings → Pages**, selecione **GitHub Actions** como fonte. Cadastre `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` em **Settings → Secrets and variables → Actions → Secrets** antes de publicar.

Adicione também o endereço publicado à allowlist de Redirect URLs em **Supabase → Authentication → URL Configuration**. O workflow não recebe nem usa `.env.local`. A chave anon/publicável é incorporada ao JavaScript entregue ao navegador e não pode ser tratada como segredo; use somente com RLS habilitada e nunca coloque uma chave `service_role` nesses secrets.

## Tecnologias

React, Vite, TypeScript estrito, Tailwind CSS, Zustand com `persist` e Lucide React.
