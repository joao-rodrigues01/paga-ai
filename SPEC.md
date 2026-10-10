# PagaAí — Especificação funcional e técnica

**Estado do documento:** descreve o comportamento implementado no MVP atual e registra ideias futuras sem tratá-las como funcionalidades disponíveis.

## 1. Visão do produto

PagaAí ajuda uma pessoa a organizar gastos compartilhados com amigos, identificar quanto cada participante deve e acompanhar os pagamentos. O MVP é **single-player e admin-only**: somente o dono do navegador opera a aplicação. Amigos e dependentes são registros administrados pelo dono; eles não têm conta nem acesso próprio.

Todos os dados ficam no `localStorage` do navegador usando Zustand `persist`. Não existe backend, autenticação, API de negócio, sincronização entre navegadores ou envio de cobranças.

## 2. Princípios e limites do MVP

- O navegador e seu `localStorage` são a fonte dos dados.
- Cada despesa tem um valor total, uma data de compra, um meio de pagamento, uma quantidade de parcelas e participantes com suas partes individuais.
- O dashboard considera o vencimento da parcela para determinar o mês a que ela pertence.
- Um dependente tem um responsável pagador. A dívida do dependente é registrada separadamente, mas usa o `friendId` do responsável para agrupar e cobrar.
- A parte do perfil “Eu” é registrada como já quitada para não entrar no valor a receber.
- O MVP permite criar, editar e excluir registros dentro das proteções de relacionamento e histórico descritas abaixo.
- Despesas com pagamentos de amigos registrados não podem ser alteradas ou apagadas, para preservar o histórico financeiro.
- Dados locais podem ser perdidos ao limpar o armazenamento do navegador ou trocar de dispositivo. O usuário pode exportar e restaurar um backup JSON manualmente.

## 3. Funcionalidades implementadas

### 3.1 Navegação

A aplicação possui as seções **Visão geral**, **Despesas**, **Amigos** e **Cartões**, com navegação lateral em telas largas e navegação inferior em telas menores. Os formulários de criação são abertos pelo botão principal da seção.

### 3.2 Perfil do administrador (“Eu”)

- A store começa com um perfil padrão com `isMe: true`; não é necessário cadastrá-lo.
- O perfil é identificado por um ID estável e reaparece durante a hidratação/migração dos dados persistidos se estiver ausente.
- A normalização mantém apenas um perfil `isMe`.
- “Eu” aparece primeiro no seletor de participantes e vem selecionado por padrão. O usuário pode desmarcá-lo.
- A parte de “Eu” é registrada em cada parcela como quitada e é excluída dos totais **a receber** e **recebidos** do dashboard.

### 3.3 Amigos e dependentes

- Um amigo contém nome, avatar (emoji ou URL de imagem), chave Pix opcional, flag `isMe`, lista de dependentes e data de criação.
- O formulário de novo amigo aceita dependentes separados por vírgula. Cada nome gera um `Dependent` com ID próprio.
- No seletor de participantes, amigos aparecem abaixo de “Eu”; os dependentes aparecem indentados logo abaixo do respectivo responsável.
- Cada participante pode ser incluído separadamente na divisão. Para um dependente, `friendId` identifica quem paga e `dependentId` identifica de quem foi a parte.
- O dashboard agrupa o valor pelo responsável. Na lista da despesa, o participante é identificado como “Dependente · Responsável”.
- A chave Pix é informativa; o aplicativo não inicia pagamentos nem envia cobranças Pix.

### 3.4 Cartões

- Um cartão possui nome, dia de fechamento e dia de vencimento.
- Os dias devem ser números inteiros entre 1 e 31.
- Uma despesa pode ser vinculada a um cartão cadastrado ou marcada como Pix.
- O dashboard apresenta os totais de parcelas de cartão no mês selecionado, agrupados por cartão.

### 3.5 Despesas e divisão

O formulário de despesa inclui:

- título;
- data da compra;
- valor total em reais;
- Pix ou cartão cadastrado;
- quantidade de parcelas, de 1 a 48;
- participantes, inicialmente com “Eu” selecionado;
- cota total de cada participante na compra, inicialmente dividida igualmente e editável;
- prévia do valor de cada parcela para cada participante quando a compra é parcelada.

O campo de divisão representa a participação da pessoa no valor total da compra, não o valor mensal. Por exemplo, em uma compra de R$ 3.923,17 em 6 vezes dividida em 5 cotas, cada cota fica próxima de R$ 784,63 no total e de R$ 130,77 por parcela. Um dependente selecionado conta como uma cota individual e sua cobrança é agrupada com a do responsável.

Antes de gravar, a store valida título, data, valor positivo, quantidade de parcelas, existência do cartão e dos participantes, unicidade de cada par participante/dependente e igualdade entre a soma das partes e o valor total. A comparação monetária é feita em centavos inteiros.

Uma seleção não pode incluir o mesmo amigo duas vezes. O mesmo responsável pode aparecer uma vez por si e uma vez por dependente, pois esses são participantes distintos.

### 3.6 Parcelas e vencimentos

Ao salvar uma despesa, a store cria um registro `Expense` e um registro `ExpenseInstallment` por parcela, incluindo também despesas à vista (`installmentsCount: 1`). Para cada parcela, cria uma `ExpenseSplit` por participante.

#### Cartão de crédito

1. Se o dia da compra for menor ou igual ao dia de fechamento, a compra entra no ciclo cujo fechamento ocorre naquele mês.
2. Se o dia da compra for posterior ao fechamento, a compra entra no ciclo seguinte.
3. Se o dia de vencimento for menor ou igual ao dia de fechamento, o vencimento da parcela cai no mês seguinte ao mês de fechamento do ciclo. Caso contrário, cai no mesmo mês do fechamento.
4. As parcelas seguintes vencem mensalmente no dia de vencimento do cartão.
5. Se o dia não existir em um mês (por exemplo, dia 31 em fevereiro), usa-se o último dia daquele mês.

#### Pix

- A primeira parcela vence na data da compra.
- Parcelas seguintes vencem mensalmente no mesmo dia, limitado ao último dia do mês quando necessário.
- O formulário avisa que o parcelamento Pix é uma projeção mensal; não há processamento de pagamentos.

#### Valores e centavos

- Cada participante tem uma parte do total da compra e a soma dessas partes deve corresponder ao total.
- Primeiro, o total é dividido pelo número de parcelas em centavos inteiros; centavos restantes vão para as primeiras faturas (R$ 3.923,17 em 6x gera R$ 653,87 na primeira e R$ 653,86 nas demais).
- A distribuição das cotas nas parcelas preserva simultaneamente o total devido por participante e o valor de cada fatura. Algumas cotas mensais podem variar em um centavo para que ambas as somas fechem exatamente.

### 3.7 Baixa de pagamento

- Na seção Despesas, cada divisão de cada parcela pode ser marcada como paga individualmente.
- A baixa define `isPaid: true` e grava `paidAt` em ISO Date.
- Uma divisão já paga não apresenta novamente a ação de baixa.
- O perfil “Eu” é exibido como “Sua parte”; sua divisão é tratada como quitada automaticamente.

### 3.8 Dashboard e filtro mensal

- O filtro `input type="month"` seleciona mês e ano.
- Totais e gráfico usam parcelas cujo `dueDate` pertence ao mês selecionado.
- **A receber** é a soma das divisões não pagas de participantes que não são o perfil “Eu”.
- **Recebido** é a soma das divisões pagas desses participantes. O pagamento é atribuído ao mês de vencimento da parcela, mesmo se `paidAt` for de outro mês.
- O gráfico de rosca representa a proporção entre recebido e pendente no mês filtrado.
- “Próximas faturas” mostra, para cada cartão com parcelas no mês filtrado, o total dessas parcelas e o primeiro vencimento do mês.
- A lista de despesas recentes apresenta despesas completas; o filtro mensal afeta os resumos do dashboard, não essa lista.

### 3.9 Gestão, histórico, backup e robustez

- Amigos podem ser editados e excluídos. O perfil “Eu” é fixo e não pode ser excluído. Um amigo usado em uma divisão precisa ser removido dessa despesa antes de poder ser excluído.
- Dependentes podem ser adicionados, renomeados e removidos depois do cadastro do responsável. Dependentes já usados em despesas não podem ser removidos, evitando referências quebradas.
- Cartões podem ser renomeados, editados e excluídos. Se estiverem ligados a despesas, seus dias de fechamento/vencimento ficam bloqueados e o cartão não pode ser excluído. Desvincule as despesas antes de alterar as datas ou remover o cartão.
- Despesas sem pagamentos de amigos podem ser editadas: parcelas e divisões são regeneradas a partir do novo valor, número de parcelas e participantes. Não são permitidas partes que não fechem com o total.
- Despesas com qualquer pagamento de amigo registrado não podem ser editadas nem excluídas. O perfil “Eu”, cuja parte é marcada paga automaticamente, não conta como pagamento externo para essa proteção.
- Despesas sem pagamentos de amigos podem ser excluídas; as parcelas e divisões relacionadas são removidas junto.
- A tela de cartões detalha cada compra vinculada, parcelas, datas de vencimento, valor da fatura e progresso de pagamentos por parcela.
- O dashboard mantém o resumo por vencimento e inclui um histórico mensal separado, filtrado por `paidAt` real. Esse histórico mostra o pagador, dependente, despesa, parcela, data da baixa e valor recebido.
- O usuário pode exportar um backup JSON completo ou importar um backup JSON PagaAí. A importação pede confirmação e valida os IDs, referências e somas de despesas, parcelas e divisões antes de substituir os dados atuais.
- Os modais fecham com Escape, mantêm o foco dentro do diálogo e restauram o foco ao fechar. Ações de exclusão pedem confirmação.
- Se o navegador bloquear leitura/escrita no `localStorage` ou exceder a quota, o app informa o problema. Escritas que falham ficam em memória durante a sessão e não são garantidas após recarregar; por isso a interface orienta exportar um backup.
- Há testes automatizados de regras de datas, parcelas, centavos e migração. Execute-os com `npm test` em Node.js 22.6 ou superior.

## 4. Modelo de dados

Os tipos oficiais estão em `src/types.ts`.

```ts
interface Dependent {
  id: string
  name: string
}

interface Friend {
  id: string
  name: string
  avatar: string
  pixKey?: string
  isMe?: boolean
  dependents?: Dependent[]
  createdAt: string
}

interface CreditCard {
  id: string
  name: string
  closingDay: number
  dueDay: number
}

interface Expense {
  id: string
  title: string
  totalAmount: number
  date: string
  creditCardId?: string
  installmentsCount: number
  createdAt: string
}

interface ExpenseInstallment {
  id: string
  expenseId: string
  installmentNumber: number
  amount: number
  dueDate: string
}

interface ExpenseSplit {
  id: string
  expenseInstallmentId: string
  friendId: string
  dependentId?: string
  amountOwed: number
  isPaid: boolean
  paidAt?: string
}
```

Relacionamentos:

- `Expense.creditCardId` é opcional e referencia `CreditCard.id`.
- `ExpenseInstallment.expenseId` referencia a despesa original.
- `ExpenseSplit.expenseInstallmentId` referencia uma parcela específica.
- `ExpenseSplit.friendId` identifica quem é responsável pelo pagamento.
- `ExpenseSplit.dependentId`, quando informado, identifica o dependente do responsável.

## 5. Store e persistência

A store está em `src/store/useAppStore.ts` e persiste no `localStorage` com a chave `pagaai-storage`, versão 3.

Estado persistido:

- `friends`
- `creditCards`
- `expenses`
- `expenseInstallments`
- `expenseSplits`

Ações atuais:

- `addFriend(friend)`
- `addCreditCard(card)`
- `addDependent(friendId, name)`
- `addExpense(expense)`
- `markAsPaid(splitId)`
- `ensureMe()`

Ao migrar dados da versão anterior, a store adiciona o perfil padrão se necessário, define despesas antigas como uma parcela e liga as divisões antigas à parcela criada. A migração preserva os dados existentes do navegador sempre que os registros antigos são válidos.

## 6. Stack e estrutura do projeto

- React + Vite
- TypeScript com `strict` habilitado
- Tailwind CSS
- Zustand `persist`
- Lucide React

Arquivos centrais:

- `src/App.tsx`: navegação, dashboard e telas de listagem.
- `src/components/ExpenseForm.tsx`: formulário de despesa, participantes e parcelas.
- `src/store/useAppStore.ts`: estado, validações, cálculo de parcelas e persistência.
- `src/types.ts`: interfaces de domínio.

## 7. Próximas fases — fora do MVP local atual

Estas ideias não devem ser consideradas implementadas. Qualquer agente que trabalhe nelas deve preservar o modo local do MVP até que uma decisão explícita aprove uma mudança arquitetural.

### Próximos passos de organização e entrega

- [ ] Configurar versionamento Git para o projeto, com histórico de alterações e convenção de commits.
- [ ] Mover/publicar o projeto na pasta ou repositório do GitHub com o nome **PagaAí**.

### Fase futura com backend (possível Fase 2)

- Migrar dados para uma API/BaaS, possivelmente Supabase/PostgreSQL.
- Autenticação, sincronização entre dispositivos e migração assistida do armazenamento local.
- Políticas de acesso e cópias de segurança adequadas a dados financeiros pessoais.
- O primeiro desenho de referência para Supabase está em `supabase/schema.sql`; ele é planejamento e não está conectado ao app atual.
- A conta autenticada representa apenas “Eu”. Amigos locais sem conta são importados como `contacts` privados do dono; seus dependentes continuam ligados ao contato. Dados compartilhados passam a usar `groups`, associação com contas e contatos explicitamente compartilhados.
- Importar entidades com os UUIDs locais e usar `upsert` idempotente dentro de uma transação/RPC. Um backup JSON integral permanece intacto até a conferência dos totais e relacionamentos no servidor; login, por si só, não importa nem apaga dados locais.
- Convites/associação de um contato a uma conta exigem confirmação explícita e migração transacional das divisões/dependentes; nunca associar por nome ou e-mail digitado sem verificação.
- Criar despesas, parcelas e divisões será uma única RPC/transação para validar, no commit, totais da compra, parcelas e cotas. O Zustand/localStorage só deixa de ser fonte principal depois de sincronização e reconciliação concluídas.

### Fase futura multiusuário / nativa (possível Fase 3)

- Permitir que amigos visualizem ou atualizem suas próprias dívidas por conta própria.
- Convites, permissões e reconciliação de pagamentos entre participantes.
- Aplicativo nativo com React Native/Expo.
- Notificações de vencimentos ou lembretes, somente após definir consentimento e infraestrutura.

## 8. Diretrizes para agentes que continuarem o projeto

1. Leia este documento e `README.md` antes de alterar a arquitetura.
2. Mantenha `src/types.ts` como contrato de dados e atualize a versão/migração da store quando o formato persistido mudar.
3. Não introduza backend, autenticação ou APIs externas sem solicitação explícita.
4. Preserve as invariantes: uma única pessoa `isMe`, divisões em centavos que fecham com o total e relacionamento válido parcela → divisão → responsável/dependente.
5. Distingua claramente comportamento implementado de propostas futuras na documentação e na interface.
