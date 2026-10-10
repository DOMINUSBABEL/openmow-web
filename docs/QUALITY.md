# QUALITY.md — Criterio de trabajo (estándar "nivel arquitecto")

Este archivo sustituye al juicio del arquitecto cuando no está presente. Aplícalo en CADA tarjeta.

## 1. Bucle obligatorio por tarjeta (no saltarse pasos)
1. **Leer**: tarjeta + secciones citadas de `docs/KNOWLEDGE.md` + código que vas a tocar (completo, no por fragmentos).
2. **Medir antes de construir**: escribe primero un *probe* en `tools/re/` que cuente/valide sobre los DATOS REALES de las 15 misiones (no sobre un ejemplo). Guarda la salida en `.txt`. Ejemplo: antes de implementar `actor_state`, lista todas sus formas de argumentos en el alcance.
3. **Hipótesis explícita**: escribe en 1-3 líneas qué crees que significa el dato y cómo lo vas a refutar. Si no puedes refutarla con datos, márcala `ASUNCIÓN` en `docs/DECISIONS.md`.
4. **Implementar lo mínimo que cubra el 100 % del censo** (no el 80 %): todo caso no soportado debe fallar ruidosamente (`console.warn`/report con contador), nunca silenciosamente.
5. **Test automático** sobre TODOS los casos reales del alcance (patrón de `tools/tests/test_*_all.py`): cuenta OK/FAIL y lista los fallos. Para lógica TS: vitest con fixtures extraídos de los datos reales.
6. **Verificación visual** cuando haya render: `tools/shot.ps1` + mirar el PNG. "Compila" ≠ "funciona".
7. **Auto-revisión** (checklist §3) y solo entonces `Estado: DONE — <comando> → <resultado>`.

## 2. Principios de arquitectura (para pulirla sin romperla)
- **Datos > código**: el juego es data-driven; cualquier constante debe salir de `.def/.set/.mi`. Si hardcodeas un número, cita en comentario el archivo GEM2 del que lo sacaste o márcalo `TUNING` en DECISIONS.
- **Capas estrictas**: `engine` (puro, determinista, sin DOM/three, `Math.random` prohibido → usar PRNG con semilla) · `render` (lee estado) · `ui` (DOM) · `mission` (VM). Una dependencia inversa = bug de arquitectura.
- **Determinismo**: tick fijo 20 Hz; tiempo de juego = ticks/20. Toda la sim se puede correr headless en Node (el arnés T16 depende de esto).
- **Contratos primero**: si necesitas un dato nuevo del servidor, añade primero el tipo en `web/src/contracts/` (campo opcional) y el JSON de ejemplo en el docstring del endpoint; luego implementa ambos lados.
- **Un conversor = una función pura** `(vfs, ruta) -> bytes|dict` + endpoint + entrada en caché versionada + test sobre todo el alcance.
- **Refactor permitido** solo si: (a) mantiene todos los tests verdes, (b) reduce duplicación o acoplamiento medible, (c) se documenta en DECISIONS. Nunca refactors "estéticos" en mitad de una tarjeta.
- **Rendimiento objetivo**: 60 fps con ~600 entidades en Radeon 780M. Instancing para props repetidos (sandbags), LOD de GLB (`?lod=1/2`), frustum culling; medir con `renderer.info`.
- **Fallos visibles**: overlay de depuración (`?debug=1`) con contadores: protos sin resolver, nodos de trigger desconocidos, entidades no colocadas.

## 3. Checklist de auto-revisión (copiar a la tarjeta y marcar)
- [ ] ¿Cubre el 100 % de las formas del censo del alcance? (adjunta números)
- [ ] ¿Hay algún caso que se ignore en silencio? (debe haber 0)
- [ ] ¿Tests de decoders + vitest + build verdes?
- [ ] ¿Respeta capas y contratos? ¿`engine` sigue sin importar three/DOM?
- [ ] ¿Cada constante tiene origen GEM2 o etiqueta TUNING?
- [ ] ¿Captura visual revisada (si aplica)?
- [ ] ¿DECISIONS/ESCALATIONS actualizados?
- [ ] ¿El usuario puede probarlo en una URL concreta de localhost? (escríbela en la tarjeta)

## 4. Ingeniería inversa: cómo razonar cuando falta información
1. Busca el mismo concepto en otros archivos (`find_define.py`, grep en `/set`, `/properties`): el motor es consistente; un nombre aparece en su definición y en sus usos.
2. Estadística sobre todo el corpus: rangos, histogramas, correlaciones (así se dedujeron FVF y EANM). Un campo con valores 0..N-1 es un índice; floats en [-1,1] con norma 1 son direcciones/cuaterniones.
3. Fuerza bruta acotada de hipótesis (offset/stride/orden de ejes) con una métrica objetiva (p.ej. "% de cuaterniones unitarios", "normales coherentes con las caras").
4. Ghidra sobre `mowas_2.exe` está **autorizado** solo para fórmulas no inferibles (p. ej. penetración de blindaje). Documenta la función y la dirección en KNOWLEDGE.
5. Si tras 2 intentos serios no converge → ESCALATIONS con: hipótesis probadas, evidencia, fallback implementado.

## 5. Fallbacks pre-aprobados (úsalos sin escalar)
| Problema | Fallback |
|---|---|
| `map.net`/`map.grs` indescifrables | navegación propia por rejilla (T08); sin hierba o hierba instanciada simple |
| Orugas procedurales | banda simple a lo largo de las ruedas o malla oculta |
| Shaders GEM2 (bump/specular) | `MeshStandardMaterial` con diffuse + normalMap si existe `bump` |
| Fórmula de daño desconocida | modelo simplificado documentado: penetración(mm, distancia) vs blindaje efectivo (espesor/cos ángulo) de los macros `armor_*`; daño a humanos = `healthDamage` |
| Efectos/partículas (`.ebm`, fx) | sprites simples de fogonazo/humo/explosión |
| Voces/`talk` | subtítulo con el texto `$/clave` |
