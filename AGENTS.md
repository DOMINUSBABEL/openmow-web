# AGENTS.md — OpenMoW-Web (protocolo para el agente ejecutor)

> Lee este archivo COMPLETO antes de tocar código. Luego ejecuta `docs/TASKS.md` en orden.
> Arquitecto: Claude Opus. Ejecutor: Gemini Flash. Idioma de docs/commits: español.

## 1. Objetivo
Port jugable en navegador (localhost) de *Men of War: Assault Squad 2*, leyendo los assets ORIGINALES del
usuario en solo-lectura. Alcance v1 = **15 escaramuzas** (3 por facción, ver §6). Campañas = v2.
"Jugable" (definición aceptada por el usuario): cada misión carga sin errores, coloca el 100 % de sus
entidades, ejecuta todos sus triggers sin nodos desconocidos, y puede ganarse y perderse.

## 2. Reglas inviolables
1. **Nunca** escribir en `C:\Program Files (x86)\Steam\steamapps\common\Men of War Assault Squad 2`. Ni copiar assets en masa fuera de `.cache/`.
2. Si un dato real contradice una spec de este repo → **NO improvises**: añade entrada a `docs/ESCALATIONS.md` (plantilla allí), implementa el fallback indicado en la tarjeta y sigue con la siguiente tarea.
3. `web/src/contracts/*` está **congelado**. Solo añadir campos opcionales; cambios incompatibles → ESCALATIONS.
4. Tras tocar cualquier decoder en `tools/server/formats/` re-ejecuta su test de "todos los archivos" (§5). Deben seguir en verde.
5. Una tarjeta solo está DONE cuando su **Aceptación** pasa con un comando reproducible; anota el resultado en la tarjeta (`Estado: DONE — <evidencia>`).
6. PowerShell: no uses `python -c` con regex/corchetes; escribe scripts en archivo. Redirige salidas largas a `.txt`.
7. Al cambiar un conversor sube su número en `CONVERTER_VERSION` (`tools/server/main.py`) para invalidar `.cache/`.
8. Decisiones de diseño nuevas → `docs/DECISIONS.md` (1-3 líneas, fecha, motivo).

## 3. Arquitectura
```
[.pak originales] --VFS(zip stored, por offset)--> tools/server (Python 3.11, stdlib + numpy + Pillow)
      |  /vfs/<p> bruto  /conv/tex/<p>.png  /conv/model/<def|mdl>.glb  /conv/sdl/<p>.json
      |  (nuevos: /conv/proto/..json  /conv/terrain/<mision>.glb  /conv/anim/<p>.json  /api/missions)
      v
web/ (Vite + TS estricto + three 0.170)  ->  build en web/dist servido por el mismo server :8080
  src/contracts/   tipos congelados (coords.ts …)
  src/engine/      sim determinista 20 Hz (sin three)   <- lógica pura, testeable con vitest
  src/render/      three.js (lee estado de sim, nunca lo muta)
  src/mission/     loader MissionDoc + Trigger VM
  src/ui/          menús/HUD (DOM + CSS)
  src/tools/       visores de depuración (viewer.html, map.html)
```
- Sim y render separados: `engine` no importa three. Render interpola entre ticks.
- Todo dato de juego viene del servidor convertido; el cliente no parsea binarios GEM2 salvo JSON.
- Arranque: `.\run.ps1` (build + server) → http://127.0.0.1:8080 . Sin build: `.\run.ps1 -NoBuild`.

## 4. Contratos clave (congelados)
- **Unidades**: 1 unidad GEM2 = 5 cm (20 u = 1 m). z arriba, mano izquierda.
- **Coordenadas**: three = (gem.x, gem.z, gem.y) aplicado UNA vez en el nodo raíz (`createGemRoot()` de `web/src/contracts/coords.ts`). Todo lo demás (GLB, posiciones de misión, terreno) se mete en GEM bajo ese nodo.
- **Modelos**: el bone raíz `basis` suele llevar `Orientation diag(1,-1,1)` (espejo Max→motor): NO lo "arregles"; three gestiona el winding por determinante. Verificado visualmente (G0).
- **GLB extras**: nodo = bone; `extras.kind` (revolute…), `extras.parameters` ("ID=body;" parseado), `extras.limits`, `extras.speed`, `extras.anims{seq:{file,speed,resume}}`, `extras.hidden`, `extras.skinned`. Mesh skinned: `mesh.extras.skin` = nombres de huesos; JOINTS_0 indexa esa lista; vértices en espacio del bone que declara el VolumeView.
- **Texturas en GLB**: URIs absolutas `/conv/tex/...png` → el cliente DEBE hacer `loader.setResourcePath(location.origin)`.
- **SDL JSON** (`/conv/sdl`): Atom citado → string; número → number; palabra → `{"w":"x"}`; nodo → `{"k":"{"|"(","i":[...]}`.
- **Rotación de entidades en misión**: `{xform zl <grados>}` = rotación sobre z (signo: verificar en T03 con una carretera/edificio alineado; si sale espejado, invertir y anotar DECISION).
- **Posición**: `{Position x y [z]}`; z ausente = sobre el terreno.

## 5. Herramientas y tests existentes (verde)
| Test | Comando (desde la raíz) | Esperado |
|---|---|---|
| Mallas EPLY | `python tools\tests\test_ply_all.py` | 52202/52202 |
| SDL | `python tools\tests\test_sdl_all.py` | 48913 sin fallos (~70 s) |
| Terreno BPLY | `python tools\tests\test_bply_all.py` | 146/146 |
| Animación EANM | `python tools\tests\test_anm_all.py` | 3977/3977 |
| Volúmenes EVLM | `python tools\tests\test_vol_all.py` | 3422/3422 |
| VFS | `python tools\tests\test_vfs.py` | OK |
| Modelos | `python tools\tests\test_model.py` | 0 fallos |
| Server smoke | (server arrancado) `python tools\tests\smoke_server.py` | todo OK |
| Captura visual | `.\tools\shot.ps1 -Url "<url>" -Out "<png>"` | PNG; revisarlo con view_file |
| Web | `cd web; npm run build; npx vitest run` | sin errores |

Scripts RE útiles: `tools/re/cat.py <vpath..>` (vuelca texto de la VFS), `tools/re/find_define.py <macro..>`,
`tools/re/glb_dump.py <url>`, `tools/re/mission_census.py` (→ `mission_census.txt`), `tools/re/proto_probe.py`.

## 6. Alcance v1 (15 misiones; rutas VFS)
```
map/single/01_usa-skirmish/{01_usa-overlord,02_usa-carentan,03_usa-ardennes}
map/single/02_ger-skirmish/{01_ger-caen,02_ger-sthilaire,03_ger-marketgarden}
map/single/03_eng-skirmish/{01_eng-battleaxe,02_eng-torch,03_eng-arnhem}
map/single/04_rus-skirmish/{01_rus-smolensk,02_rus-koenigsberg,03_rus-manchuria}
map/single/05_jap-skirmish/{01_jap-khalkhingol,02_jap-singapore,03_jap-iwojima}
```
Cada carpeta: `0.mi` (misión SDL), `map` (SDL: Land, clips), `map.ply` (BPLY terreno), `mtl0..N.mtl`,
`map.grs` (GRASPMAP, sin decodificar), `map.net` (EMAP, sin decodificar), `minimap.dds`, `preview*.dds`, `interface.set`.
Las 15 comparten plantilla: ~210 Entity, ~420 Human, ~170 Link, ~300 Tags, ~430 Inventory, ~350 Brain.

Conocimiento detallado de formatos y semántica: **`docs/KNOWLEDGE.md`** (léelo antes de T01).
