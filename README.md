# PagaAí 💸

Aplicação web para registrar gastos compartilhados, acompanhar parcelas e controlar pagamentos entre amigos. O app mantém o fluxo local existente no `localStorage`; o login Supabase está integrado. A migração aditiva de amizades/importação está em `supabase/migrations/20261012_friendships_and_local_import.sql`, mas precisa ser aplicada no projeto Supabase antes de usar convites e importação. A store e as telas de despesas ainda não sincronizam nem carregam dados da nuvem.

## Requisitos

- Node.js 22.6 ou superior (necessário para executar a suíte de testes integrada)
- npm

## Executar localmente

```bash
npm install
npm run dev
```

Para o login, copie `.env.example` para `.env.local` e configure as variáveis no seu ambiente. Não versione `.env.local` nem compartilhe chaves secretas. Cada navegador ainda mantém seus próprios dados locais; login não sincroniza dados automaticamente.

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
- Persistência principal no `localStorage` via Zustand; login via Supabase Auth.
- Ferramenta manual para importar uma vez o backup local para a conta Supabase, sem apagar o armazenamento do navegador.
- Convites de amizade com token de uso único e validade de sete dias, depois de aplicar a migração SQL e importar os contatos.
- O Dashboard lista em modo de consulta as despesas, parcelas e cotas compartilhadas com a conta autenticada.
- Amigos podem marcar uma parcela ou todas as próprias cotas de uma despesa como pagas. O administrador sincroniza os status pagos das divisões importadas ao abrir o app ou voltar à aba.
- Edição de despesas e sincronização contínua ainda não estão ligadas ao Supabase.

Consulte [SPEC.md](./SPEC.md) para a especificação funcional, regras de cálculo, arquitetura Supabase atual e etapas ainda pendentes.

## Supabase: ativação incremental

O projeto já pode conter `supabase/schema.sql` (modelo anterior, com grupos). As migrações novas são aditivas e preservam essas tabelas e registros. Execute os arquivos `20261012_friendships_and_local_import.sql`, `20261013_shared_payment_actions.sql`, `20261013_sync_local_friends.sql` e `20261014_sync_local_expenses.sql` no SQL Editor, nessa ordem. Não execute o schema inicial novamente em produção.

Depois, entre com a conta administradora e use **Migrar / sincronizar dados**. Na primeira execução, importa o backup completo. Em execuções seguintes, sincroniza amigos, dependentes e despesas locais sem duplicar despesas já enviadas. Despesas criadas após a migração inicial são enviadas ao Supabase no cadastro; em caso de falha, use o botão para tentar novamente. A ferramenta preserva o `localStorage`. Convide amigos pela ação ao lado do contato importado. Após aceitar o convite, o amigo verá apenas suas cotas nas abas Dashboard e Despesas e poderá marcar uma parcela ou a conta toda como paga; ele não precisa sincronizar dados. Os pagamentos feitos por amigos aparecem ao administrador quando ele abre o app ou retorna à aba.

## Publicação

O GitHub Actions compila e publica `dist/` no GitHub Pages a cada push em `main`. Para o repositório `paga-ai`, o endereço esperado é `https://<usuario>.github.io/paga-ai/`. Em **Settings → Pages**, selecione **GitHub Actions** como fonte. Cadastre `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` em **Settings → Secrets and variables → Actions → Secrets** antes de publicar.

Adicione também o endereço publicado à allowlist de Redirect URLs em **Supabase → Authentication → URL Configuration**. O workflow não recebe nem usa `.env.local`. A chave anon/publicável é incorporada ao JavaScript entregue ao navegador e não pode ser tratada como segredo; use somente com RLS habilitada e nunca coloque uma chave `service_role` nesses secrets.

## Tecnologias

React, Vite, TypeScript estrito, Tailwind CSS, Zustand com `persist` e Lucide React.
