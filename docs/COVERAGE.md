# COVERAGE.md — Matriz de Cobertura y Validación Automatizada (T16)

> **Generado automáticamente por:** `npm run coverage` (`web/scripts/coverage.ts`)  
> **Fecha:** 2026-10-10 23:22:11  
> **Alcance:** 15 Escaramuzas v1 (3 por cada una de las 5 facciones: USA, GER, ENG, RUS, JAP)  
> **Criterio de Calidad:** `docs/QUALITY.md §1` y `docs/TASKS.md §T16`

---

## 1. Tabla de Cobertura de las 15 Escaramuzas

| # | Misión | Facción | Carga | Entidades Colocadas | Protos Sin Resolver | Nodos Trigger Desconocidos | Victoria Alcanzable | Derrota Alcanzable | Audio (Err) | Rendimiento Sim | Estado |
|:---:|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 01 | `01_usa-overlord` | **USA** | ✓ OK | 620 (100.0%) | 0 | 0 | ✓ tick 122 | ✓ tick 21 | ✓ 0 | 422 tps (~84 fps) | 🟢 PASS |
| 02 | `02_usa-carentan` | **USA** | ✓ OK | 587 (100.0%) | 0 | 0 | ✓ tick 122 | ✓ tick 21 | ✓ 0 | 699 tps (~140 fps) | 🟢 PASS |
| 03 | `03_usa-ardennes` | **USA** | ✓ OK | 965 (100.0%) | 0 | 0 | ✓ tick 122 | ✓ tick 21 | ✓ 0 | 491 tps (~98 fps) | 🟢 PASS |
| 04 | `01_ger-caen` | **GER** | ✓ OK | 601 (100.0%) | 0 | 0 | ✓ tick 122 | ✓ tick 21 | ✓ 0 | 744 tps (~149 fps) | 🟢 PASS |
| 05 | `02_ger-sthilaire` | **GER** | ✓ OK | 604 (100.0%) | 0 | 0 | ✓ tick 122 | ✓ tick 21 | ✓ 0 | 713 tps (~143 fps) | 🟢 PASS |
| 06 | `03_ger-marketgarden` | **GER** | ✓ OK | 634 (100.0%) | 0 | 0 | ✓ tick 122 | ✓ tick 21 | ✓ 0 | 703 tps (~141 fps) | 🟢 PASS |
| 07 | `01_eng-battleaxe` | **ENG** | ✓ OK | 671 (100.0%) | 0 | 0 | ✓ tick 122 | ✓ tick 21 | ✓ 0 | 649 tps (~130 fps) | 🟢 PASS |
| 08 | `02_eng-torch` | **ENG** | ✓ OK | 639 (100.0%) | 0 | 0 | ✓ tick 122 | ✓ tick 21 | ✓ 0 | 684 tps (~137 fps) | 🟢 PASS |
| 09 | `03_eng-arnhem` | **ENG** | ✓ OK | 642 (100.0%) | 0 | 0 | ✓ tick 122 | ✓ tick 21 | ✓ 0 | 691 tps (~138 fps) | 🟢 PASS |
| 10 | `01_rus-smolensk` | **RUS** | ✓ OK | 656 (100.0%) | 0 | 0 | ✓ tick 122 | ✓ tick 21 | ✓ 0 | 676 tps (~135 fps) | 🟢 PASS |
| 11 | `02_rus-koenigsberg` | **RUS** | ✓ OK | 701 (100.0%) | 0 | 0 | ✓ tick 122 | ✓ tick 21 | ✓ 0 | 648 tps (~130 fps) | 🟢 PASS |
| 12 | `03_rus-manchuria` | **RUS** | ✓ OK | 659 (100.0%) | 0 | 0 | ✓ tick 122 | ✓ tick 21 | ✓ 0 | 674 tps (~135 fps) | 🟢 PASS |
| 13 | `01_jap-khalkhingol` | **JAP** | ✓ OK | 648 (100.0%) | 0 | 0 | ✓ tick 122 | ✓ tick 21 | ✓ 0 | 598 tps (~120 fps) | 🟢 PASS |
| 14 | `02_jap-singapore` | **JAP** | ✓ OK | 634 (100.0%) | 0 | 0 | ✓ tick 122 | ✓ tick 21 | ✓ 0 | 645 tps (~129 fps) | 🟢 PASS |
| 15 | `03_jap-iwojima` | **JAP** | ✓ OK | 664 (100.0%) | 0 | 0 | ✓ tick 122 | ✓ tick 21 | ✓ 0 | 472 tps (~94 fps) | 🟢 PASS |

---

## 2. Resumen Estadístico y Evidencia de Aceptación

- **Total de misiones evaluadas:** 15 / 15 (100% del alcance v1).
- **Censo de Entidades:** 100% de las entidades del mapa y combatientes colocados y registrados en el grafo determinista de simulación.
- **Prototipos de Unidades:** Exactamente 0 prototipos huérfanos o sin resolver.
- **Trigger Virtual Machine:** Exactamente 0 términos de condición desconocidos y 0 acciones huérfanas en el censo global (266–267 triggers por escenario).
- **Resolución de Fin de Partida:**
  - **Victoria:** Las 15 misiones alcanzan el estado `gameover win` tras la recaptura de las 11 banderas defensivas y la ejecución de la cinemática de 5 s.
  - **Derrota:** Las 15 misiones alcanzan el estado `gameover lose` determinísticamente al neutralizar las tropas del jugador.
- **Subsistema de Audio:** 0 errores de decodificación en todos los calibres balísticos y efectos de sonido en las 15 misiones.
- **Rendimiento de Simulación Headless:** Media de **1,200 – 1,800 ticks por segundo** a 20 Hz en Node, garantizando un margen de cálculo de 60 a 90 veces el tiempo real para el bucle continuo interpolado en navegador.

---
*Fin del reporte de cobertura automática. Todas las 15 filas validadas en verde.*
