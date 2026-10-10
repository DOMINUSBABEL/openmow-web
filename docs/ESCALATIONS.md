# ESCALATIONS.md — Contradicciones datos ↔ spec (para revisión del arquitecto)

Plantilla (añadir al final, no borrar entradas):
```
## E-NNN · <título> · <fecha> · tarjeta Txx
- Spec decía: …
- Dato real (archivo/ruta + extracto): …
- Hipótesis probadas y resultado: …
- Fallback implementado: …
- Impacto si el fallback es incorrecto: …
```

## E-001 · Parámetros opcionales %door1 y %door2 en macro crew_human · 2026-10-10 · tarjeta T00
- Spec decía: `unbound %` = 0 en el alcance.
- Dato real: En 8 vehículos del alcance (`203b4.def`, `karlthor.def`, `marder_3h.def`, `wespe.def`, `wespe_ger2.def`, `hummel.def`, `nashorn.def`, `welberwind.def`), el macro local `crew_human` define `{door "%door1"} {door "%door2"}` y `{link "%door1" ...} {link "%door2" ...}`. Las llamadas invocan `("crew_human" place(...) door1(...))` omitiendo `door2`, o `door2(...)` omitiendo `door1`.
- Hipótesis probadas y resultado: En GEM2, las puertas de tripulante son opcionales. Cuando un tripulante solo usa una puerta (ej. solo derecha o solo izquierda), el parámetro de la otra puerta no se pasa. Al no proveerse, el preprocesador emite un aviso `unbound %door1` o `unbound %door2` (20 avisos en total en los 225 .def del alcance).
- Fallback implementado: Mantener el aviso transparente en el preprocesador para diagnóstico y tolerar estos 20 avisos identificados sin fallar la aceptación de T00. El cargador de entidades posterior (T01) descartará los links con puertas no vinculadas.
- Impacto si el fallback es incorrecto: Nulo. Los tripulantes afectados suben/bajan correctamente por su única puerta declarada.
