# KNOWLEDGE.md — Formatos y semántica GEM2 (verificado empíricamente por Opus)

## A. Paquetes / VFS
- `.pak` = ZIP *stored*, sin cifrar. Montajes: `resource/*.pak`→`/`, `resource/entity/*.pak`→`/entity/`, `localization.pak`→`/localization/`.
- Precedencia: mods > map_origins2 > map_dlc_2 > map_dlc_1 > base. Rutas normalizadas a minúsculas, `/`.
- Texto: latin1 sin pérdida (comentarios en cp866/cp1251, ignorables); `.lng` = UTF-8.

## B. SDL (texto)
- `{tag args… {hijo}}` bloques de datos; `(…)` directivas/llamadas; `;` comentario; `"…"` string; `##` = nodo deshabilitado (ignorar).
- Parser: `tools/server/formats/sdl.py` (tolerante a cierres desparejados, 4 archivos del juego los tienen).
- **Preprocesador** `tools/server/formats/gem_pre.py` (ESCRITO, NO VALIDADO → tarea T00):
  - `(include "ruta" nombre(v…))` ruta absoluta (`/x` o `\x`) o relativa al archivo; args nombrados → `%nombre`.
  - `(define "n" cuerpo…)` macro; la última definición gana. Invocación `("n" a(1 2) b(x) v)` → `%a`, `%b`, `%0`.
  - `(mod "mp" …)` solo si el mod está activo → en single player NO se expande.
  - `(* a b)`, `(/ 60 %r)`, `(+ …)`, `(- …)` aritmética prefija tras sustituir.
  - Archivos `.presets` de cada directorio bajo `/set/` se incluyen implícitamente (raíz primero) — hipótesis fuerte (ej. `/set/stuff/pistol/.presets` define `"recoveryTime"`, usado por `valter`).
  - Herencia `{from "pattern pistol"}` (en `/set/stuff`) = el archivo hereda de `pistol.pattern`; hijos sobreescriben bloques con misma clave (`merge_blocks`).

## C. Prototipos (cómo se resuelve cada nombre de `0.mi`)
| En misión | Archivo |
|---|---|
| `{Entity "sandbag_woodbeam1" 0xc002 …}` | `.def` con ese basename bajo `/entity/` (índice por basename; 3 colisiones: shellhole_big, shellhole_medium → preferir `/entity/fx/common/…`? NO: preferir la que NO esté en `fx/` para estáticos; radio_station → `/entity/inventory/radio_station/`). 225/225 resueltos en el alcance |
| `{Human "mp/ger/rifle" 0x… }` | `/set/breed/mp/ger/rifle.set` → `{breed {skin "ger_t2"} {armors {head …}} {perks…} {veterancy…} {inventory {item…}}}`; skin → `/entity/humanskin/ger_t2/ger_t2.def`. 115/115 |
| `{item "valter" …}` | `/set/stuff/<cat>/valter` (sin extensión) |
| `{item "pistol" "ammo" 100}` / `"ammo pistol"` | `/set/stuff/ammo/pistol.ammo` (patrón `"<ext> <nombre>"` → `<nombre>.<ext>`) |
| `"grenade m24"` | `/set/stuff/grenade/*/m24.grenade` |
| `"bullet88 ap"` | `/set/stuff/shell/bullet88.ap.ammo` |
| stuff `{entity "valter"}` | modelo visual = `.def` basename `valter` |
| `{item "0x8000" …}` en Inventory | referencia a otra entidad por id (hex) — verificar en T01 |
- Entidad `.def`: `{game_entity|actor (include "/properties/tank.ext") {Extension "x.mdl"} {props …} {Volume "n" {tags}{component}{Thickness}} {extender "inventory" {box {item…}}} {Weaponry {place "gun" {weapon "88mm_kwk36" filling "ammo bullet88 ap" 1}}} {mass} {Chassis {Locomotion ("locomotion") {MaxSpeed 22}…}} (macros de blindaje "armor_heavy" turret(100 80 80 25) …)}`.

## D. Misión `0.mi` (`{mission …}` hijos directos)
- `Entity`/`Human` `"proto" <id hex>` con `{Position x y [z]}`, `{xform zl grados}`, `{Player n}`, `{MID n}`, `{TexMod "ger"}` (variante de textura `name#ger`?), `{Impregnability full}`, `{FsmState "stand"}`, `{NameId}`, `{Able "personage"}`, `{SpawnedInFog}`, `{Placer {State …}}`, `{Extender …}`, `{Volume …}`.
- `{Link <idHumano> {<idVehículo> "driver"|"gunner"|"commander"|"charger"|"seatN"}}` tripulación.
- `{Tags "tag" <id>}` etiquetas (selectores de triggers).
- `{Inventory <id> {box {clear} {item "x" [filled] ["ammo" n] {cell c r} {user "head"}}}}`.
- `{Brain <id> {Properties {move_mode hold} {control …} {fire_mode} {look_around} {ai_move {mode disable}}}}`.
- `{Environment "skirmish/usa-omaha"}`, `{Fog 1}`, `{Players {user 0} {alias 0 "player"} {alias 1 "enemy"} {alias 2 "allied"} {alias 3 "neutral"} {diplomacy 8x8: 0 aliado,1 enemigo,2 ?}}`, `{Covers {Sector {Automatic id x y} {Name}}}`.
- `{Helpers …}`: `{event "id"}` (declaración), `{zone "circle" {position}{Name}{Radius}}` / `{zone "poly" {position}{Name}{Point x y}…}` (Point relativo a position — verificar), `{tasks {"id" {desc "$/key"} {primary} {state hidden} {point …}}}`, `{reinforcements {scoreTotal} {scoreCurrent} {"id" {state} {text "$/k"} {image} {hint} {count -1=∞} {score coste} {delay s} {eventStart "ev"} {waypoint "n"}} … "menu:1_0"…}`, `{cameras {"startview" {"key000" {position}{look_at}{fov}{time}}}}`, `{vars {"player_score"} …}`, `{waypoints …}`, `{triggers …}`.
- Textos `$/clave` → `/localization/mission/single/<faccion>-skirmish/*.lng` (UTF-8).

## E. Triggers (VM)  — semántica asumida (marcar ESCALATION si contradice)
```
{triggers {"nombre" {condition {terms {"1.entities" {selector…} {count {op "=="} {value 1}}} {"2.event" {id "x"}} …}} {actions {"delay" {time 2}} {"trigger" {name "x"}} …}}}
```
- Prefijo `N.` de los terms = orden/identidad; tipos en alcance: `event{id}`, `cmp_i{var op value}`, `entities{selector [count{op value}]}` (sin count = existe ≥1), `task{name}`, `difficulty{level}`. Combinación de terms: **AND** (asunción).
- Ciclo: trigger activo evalúa condición cada tick (o 0.5 s); al cumplirse ejecuta `actions` secuencialmente como corrutina y queda **inactivo**. `{"trigger" {name X}}` = reactivar/armar X (patrón bucle: el trigger se re-arma a sí mismo tras `delay`). Estado inicial: todos activos salvo que aparezcan desactivados (verificar flag).
- `event` (acción) `{event id}{mode on|off}{delay}`: levanta/baja un evento (las condiciones `event` lo leen).
- Acciones en alcance (36): trigger, delay, event, reinforcement{operation score_add|enable|…, name|score}, entity_state{selector, tag_add/tag_remove, inactive on/off, discovered}, actor_state{selector, control user|ai, move_mode, weapon_prepare, ai_move, movement{speed}, ai{advance_ratio}}, waypoint{who, action}, set_i{var op value}, rt_function{selector call}, objective_progress{set add title}, if{condition{type difficulty level}|…, acciones…}, sound{name}, autoassign{selector}, delete{selector}, music{start stop volume fade loop stop_all}, task{name state}, talk{selector text}, achievement (no-op), case/switch/default, actor_to_cover{selector drop covers mode}, spawn{entity waypoint}, board{selector vehicle}, autosave (no-op), gameover{result message}, ables{selector add}, fade{time color}, scenario{message camera event_on_next force_auto_complete}, emit{selector drop waypoint}, while, linker, effect, throw_off, air_attack, animate.
- **Selector**: `{tag t}`, `{zone "z"}`, `{player "1"}`, `{type human}`, `{amount n}`, `{ignore_captured_by_user 0}`, `{source advanced}{group {select {tag {tag x}}} {include {prop {prop human}}} {exclude …}}`. Varios campos = intersección.
- Censo completo con formas de argumentos: `tools/re/mission_census.txt` (secciones "condition types" / "action types").

## F. Binarios
- **EPLYBNDS** (mallas, `formats/ply.py`): chunks SKIN/MESH/VERT/INDX/ADJA/MROR/SHDW; layout de vértice por bits FVF D3D (0x002 pos, 0x008 pos+peso, 0x1000 índices UBYTE4, 0x010 normal, 0x040 color, 0x100/0x200 UV; resto del stride: 16 B tangente, 8 B UV extra). Leer solo `used_index_ranges()`. Skin: peso2 = 1-w.
- **BPLYBNDS** (terreno, `formats/bply.py`): SUBM (material por rango), BAS2 12 floats, VERT stride 44 (pos3 normal3 color u32 uv0 uv1) o 36, IND4 u32.
- **EANM** (`formats/anm.py`): FRMS n, BMAP huesos, FRM2 keyframes dispersos: flags 0x01 pos(3f), 0x02 quat xyz (w=+sqrt), 0x20 bloque por vértice. v5 heredada: MATR 3x4.
- **EVLM** (`formats/vol.py`): VERT, INDX, SIDE (1 byte/triángulo = lado de blindaje, hipótesis).
- **MDL**: `{Skeleton {animation {sequence…}} {bone [kind] "nombre" {Orientation 3x3}|{Matrix34 3x3+t}|{Position} {VolumeView "x.ply"} {LODView…} {parameters "K=V;"} {limits a b} {speed} {visibility 0} {bone …}}}` + `Volume`/`Obstacle`/`Area`.
- **MTL**: `{material bump|simple {diffuse "ref"} {bump} {specular} {color "r g b a"} {blend none|test|blend} {alpharef} {layer…}}`; `$/x` → `/texture/common/x`; probar `.dds` luego `.tga`.
- Sin decodificar: `map.net` (EMAP, navegación?), `map.grs` (GRASPMAP, hierba), `MROR`. Fallback acordado: ignorarlos y generar navegación propia (T08).

## G. Problemas conocidos
- Orugas (`trackl/trackr.ply`, skinned) se renderizan colapsadas en el origen: son geometría procedural del motor a lo largo de las ruedas → T09 (fallback: ocultarlas y dibujar una banda simple).
- `CONVERTER_VERSION` hay que subirlo al cambiar conversores.
