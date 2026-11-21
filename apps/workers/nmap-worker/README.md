# nmap-worker

Worker skanujący w **C++23**, opakowujący **nmap**. Na razie to szkielet: wypisuje konfigurację i wersję nmapa, po czym kończy działanie. Pętla HTTP pull jest opisana w [`../README.md`](../README.md).

## Budowanie i uruchomienie (Docker, zalecane)

```bash
pnpm workers:build                                                     # z roota
docker compose -f docker/docker-compose.yml --profile workers run --rm nmap-worker
```

Obraz buduje się i działa na `ubuntu:26.04` (GCC, CMake, Ninja, nmap 7.98). Build i runtime mają tę samą bazę, więc wersja libstdc++ się zgadza. Proces działa jako użytkownik `worker`, a nmap ma `setcap cap_net_raw,cap_net_admin`. Compose dodaje kontenerowi `NET_RAW` / `NET_ADMIN`, bez których nie da się robić SYN scanów ani wykrywać systemu operacyjnego.

## Budowanie lokalne

```bash
brew install cmake ninja nmap          # macOS (nie ma ich domyślnie)
cmake --preset debug && cmake --build --preset debug
./build/debug/nmap-worker
```

`compile_commands.json` ląduje w `build/<preset>/` (dla clangd).

## Konfiguracja

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `BACKEND_URL` | `http://localhost:3001/v1` | API backendu. W compose: `http://host.docker.internal:3001/v1` |

## Planowane zależności

- HTTP: libcurl (albo cpr)
- JSON: nlohmann/json
- parsowanie `nmap -oX`: pugixml
- dołączane przez CMake `FetchContent` albo pakiety systemowe w Dockerfile (do decyzji przy implementacji)

## Uwaga: Docker Desktop na macOS

Kontenery działają w maszynie wirtualnej, więc skan sieci LAN z macOS przechodzi przez NAT i wyniki mogą się różnić od skanu z Linuksa. Do testów w labie AGH uruchamiaj workera na hoście z Linuksem (opcjonalnie z `network_mode: host`).
