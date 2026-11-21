# docker/

Lokalna infrastruktura w Docker Compose. Backend i frontend uruchamiasz przez `pnpm dev`, a tutaj działa tylko to, czego potrzebują.

| Serwis | Profil | Opis |
|---|---|---|
| `postgres` | domyślny | PostgreSQL 19 (alpine), port tylko na `127.0.0.1:5432` |
| `nmap-worker` | `workers` | worker C++ z `apps/workers/nmap-worker` |

## Komendy (z roota)

```bash
pnpm db:up          # tylko Postgres
pnpm db:logs
pnpm infra:up       # wszystkie serwisy z profilu domyślnego
pnpm infra:down
pnpm workers:build  # build obrazu workera
pnpm workers:up     # build + start workera (profil workers)
pnpm workers:logs
pnpm workers:down
```

## PostgreSQL

- Obraz: `postgres:19-alpine`, named volume `hacknation-postgres-data`.
- Domyślne dane logowania: `hacknation` / `hacknation`, baza `hacknation`. Pasują do `apps/backend/.env.example`. Nadpiszesz je zmiennymi `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` (w powłoce albo w `docker/.env`).
- Wolumen jest montowany pod `/var/lib/postgresql`, a nie `.../data`. Od Postgresa 18 obraz trzyma dane w podkatalogu z numerem wersji.
- Wyczyszczenie danych: `docker compose -f docker/docker-compose.yml down -v`.

## nmap-worker

Domyślnie łączy się z backendem na hoście przez `host.docker.internal:3001`. Ma `cap_add: [NET_RAW, NET_ADMIN]`. Szczegóły są w [`apps/workers/nmap-worker/README.md`](../apps/workers/nmap-worker/README.md).
