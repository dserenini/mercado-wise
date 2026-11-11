# AGENTS.md

Regras para qualquer agente (Claude, Codex, etc.) trabalhando neste repo.

## Como a gente trabalha

Duas pessoas, cada uma com seus agentes. Toda mudança entra por **pull request**,
mas quem abre pode mergear o próprio PR, sem esperar revisão. O que importa, nesta
ordem:

1. **Não perder dados**: nem código de ninguém, nem dado do banco.
2. **Não colocar bug**, tanto quanto possível.
3. **Não perder o ritmo.**

Se os dois mexerem na mesma coisa, tudo bem: quem chegar depois resolve o conflito.

## Fluxo

1. `git pull --rebase origin main` e crie uma branch curta a partir da `main`
   (`origin` = `dserenini/mercado-wise`).
2. Commits pequenos. Antes de cada push: `npm run lint && npm run typecheck && npm test`.
3. Abra o PR contra a `main` (`gh pr create`). PR pequeno, de vida curta: abrir e
   mergear no mesmo dia é o normal.
4. **Espere todas as checagens do PR terminarem** (`gh pr checks --watch`).
   Hoje é o CI (`.github/workflows/ci.yml`); no futuro entram checagens de segurança.
   Nenhuma pode estar vermelha nem pendente. Se o PR não tiver nenhuma checagem,
   confira que isso é esperado antes de mergear.
5. Mergeie você mesmo (`gh pr merge --squash --delete-branch`).
   **Merge na `main` = deploy em produção** (Vercel).

Nunca faça push direto na `main`.

## Git

- Branch ficou pra trás ou com conflito? `git pull --rebase origin main`, resolve,
  roda a checagem completa, push de novo e espera o CI.
- Pode dar `git push --force-with-lease` **só na sua própria branch de PR** depois de
  um rebase. **Nunca** force push na `main` nem na branch de outra pessoa.
- **Nunca** descartar mudança alheia pra "resolver" conflito (`checkout --theirs/--ours`
  no arquivo inteiro, `git reset`, `git clean`, `git stash drop`) sem entender o que
  cada lado fez.

### Resolvendo conflito

- Leia os dois lados e o commit do outro (`git log -p origin/main -- <arquivo>`).
  O resultado tem que manter a intenção das duas mudanças.
- Se as duas mudanças são incompatíveis de verdade (ex.: as duas reescrevem a mesma
  função de jeitos diferentes), pare e pergunte pro humano em vez de escolher um lado.
- Depois de resolver, rode a checagem completa antes de continuar o rebase/push.

## Banco / migrations

- Migrations em `migrations/NNN_nome.sql`, aplicadas por nome de arquivo e em ordem
  (`src/db/migrate.ts`). Só **adicione** arquivos novos; nunca edite uma migration que
  já está na `main`.
- Antes de criar uma, faça pull e pegue o próximo número livre. Se depois do pull
  outra pessoa já usou o mesmo número e a sua ainda não rodou em produção, renumere a
  sua.
- Nada destrutivo sem o humano pedir explicitamente: `drop`, `truncate`, `delete` sem
  `where`, mudança de tipo que perde dado.
- `npm run migrate` em produção roda à mão, **antes** do merge do código que depende
  dela, e só com o humano sabendo.
- Código novo deve funcionar com e sem a migration nova aplicada sempre que der.

## Segredos

- `.env` nunca entra no git. Valores novos vão vazios em `.env.example`.
