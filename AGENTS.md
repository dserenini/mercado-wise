# AGENTS.md

Regras para qualquer agente (Claude, Codex, etc.) trabalhando neste repo.

## Como a gente trabalha

Duas pessoas, cada uma com seus agentes, **commitando direto na `main`**. Sem PR,
sem branch longa. O que importa, nesta ordem:

1. **Não perder dados**: nem código de ninguém, nem dado do banco.
2. **Não colocar bug**, tanto quanto possível.
3. **Não perder o ritmo.**

Se os dois mexerem na mesma coisa, tudo bem: quem chegar depois resolve o conflito.

## Git

- Trabalhe na `main` (`origin` = `dserenini/mercado-wise`).
- Antes de começar e antes de cada push: `git pull --rebase origin main`.
- Commits pequenos e frequentes; push logo depois. Quanto menos tempo o código
  fica só local, menos conflito.
- Push rejeitado? `git pull --rebase`, resolve, testa, push de novo.
- **Nunca** `git push --force` (nem `--force-with-lease`) na `main`.
- **Nunca** reescrever histórico já publicado (`reset --hard` em commit pushado,
  `rebase` de commits que já estão no remoto, `commit --amend` depois do push).
- **Nunca** descartar mudança alheia pra "resolver" conflito (`checkout --theirs/--ours`
  no arquivo inteiro, `git reset`, `git clean`, `git stash drop`) sem entender o que
  cada lado fez.

### Resolvendo conflito

- Leia os dois lados e o commit do outro (`git log -p origin/main -- <arquivo>`).
  O resultado tem que manter a intenção das duas mudanças.
- Se as duas mudanças são incompatíveis de verdade (ex.: as duas reescrevem a mesma
  função de jeitos diferentes), pare e pergunte pro humano em vez de escolher um lado.
- Depois de resolver, rode a checagem completa (abaixo) antes de continuar o rebase/push.

## Antes de cada push

```sh
npm run lint && npm run typecheck && npm test
```

Tudo verde, ou não sobe. **Push na `main` = deploy em produção** (Vercel).
O CI roda o mesmo, mas aí o deploy já foi.

## Banco / migrations

- Migrations em `migrations/NNN_nome.sql`, aplicadas por nome de arquivo e em ordem
  (`src/db/migrate.ts`). Só **adicione** arquivos novos; nunca edite uma migration que
  já foi pushada.
- Antes de criar uma, faça pull e pegue o próximo número livre. Se depois do pull
  outra pessoa já usou o mesmo número e a sua ainda não rodou em produção, renumere a
  sua.
- Nada destrutivo sem o humano pedir explicitamente: `drop`, `truncate`, `delete` sem
  `where`, mudança de tipo que perde dado.
- `npm run migrate` em produção roda à mão, **antes** do push do código que depende
  dela, e só com o humano sabendo.
- Código novo deve funcionar com e sem a migration nova aplicada sempre que der.

## Segredos

- `.env` nunca entra no git. Valores novos vão vazios em `.env.example`.
