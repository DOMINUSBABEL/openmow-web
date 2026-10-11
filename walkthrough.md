# OpenMoW-Web — Manual de Operación y Guía del Usuario (Walkthrough)

Bienvenido a **OpenMoW-Web**, la recreación fiel, determinista y de alto rendimiento de *Men of War: Assault Squad 2* ejecutada completamente en el navegador web sobre WebGL y WebAudio, conectada a los assets originales de Steam en modo solo lectura (`http://127.0.0.1:8080`).

---

## 1. Arranque Rápido del Servidor Local

Para iniciar el servidor local en cualquier momento, abre PowerShell en el directorio raíz del proyecto y ejecuta:

```powershell
.\run.ps1
```

O directamente mediante Python:
```powershell
python tools\server\main.py --port 8080
```

El servidor quedará disponible en:
👉 **[http://127.0.0.1:8080/](http://127.0.0.1:8080/)**

---

## 2. Catálogo de Escaramuzas y URLs Directas de Combate

El juego incluye soporte completo para **15 Escaramuzas oficiales (3 misiones por cada una de las 5 facciones)** con cinemáticas, triggers de combate, balística real y música contextual original.

### 🌟 Menú Principal Interactivo
- **[http://127.0.0.1:8080/](http://127.0.0.1:8080/)**: Selector de facción militar, galería de mapas tácticos, descripciones históricas y dificultad (`Fácil`, `Normal`, `Difícil`, `Heroico`).

---

### 🇺🇸 Fuerzas de Estados Unidos (USA)
1. **Operación Overlord (Normandía, Francia):**  
   👉 [http://127.0.0.1:8080/?m=map/single/01_usa-skirmish/01_usa-overlord&autoplay=1](http://127.0.0.1:8080/?m=map/single/01_usa-skirmish/01_usa-overlord&autoplay=1)  
   *Asalto a la costa normanda y avance a través de las fortificaciones del Muro del Atlántico.*
2. **Carentan (Francia):**  
   👉 [http://127.0.0.1:8080/?m=map/single/01_usa-skirmish/02_usa-carentan&autoplay=1](http://127.0.0.1:8080/?m=map/single/01_usa-skirmish/02_usa-carentan&autoplay=1)  
   *Combate urbano de infantería aerotransportada y blindados entre canales y bocages.*
3. **Ardenas (Bélgica):**  
   👉 [http://127.0.0.1:8080/?m=map/single/01_usa-skirmish/03_usa-ardennes&autoplay=1](http://127.0.0.1:8080/?m=map/single/01_usa-skirmish/03_usa-ardennes&autoplay=1)  
   *Batalla invernal en colinas nevadas contra formaciones pesadas de panzers.*

---

### 🇩🇪 Fuerzas de Alemania (GER)
1. **Caen (Normandía):**  
   👉 [http://127.0.0.1:8080/?m=map/single/02_ger-skirmish/01_ger-caen&autoplay=1](http://127.0.0.1:8080/?m=map/single/02_ger-skirmish/01_ger-caen&autoplay=1)  
   *Defensa de las ruinas de la ciudad industrial y contraataque con carros Tiger I y Panther.*
2. **Saint-Hilaire (Francia):**  
   👉 [http://127.0.0.1:8080/?m=map/single/02_ger-skirmish/02_ger-sthilaire&autoplay=1](http://127.0.0.1:8080/?m=map/single/02_ger-skirmish/02_ger-sthilaire&autoplay=1)  
   *Lucha táctica de contención y emboscadas entre cruces de carreteras y setos.*
3. **Operación Market Garden (Holanda):**  
   👉 [http://127.0.0.1:8080/?m=map/single/02_ger-skirmish/03_ger-marketgarden&autoplay=1](http://127.0.0.1:8080/?m=map/single/02_ger-skirmish/03_ger-marketgarden&autoplay=1)  
   *Defensa estratégica de puentes clave y corte de columnas aerotransportadas aliadas.*

---

### 🇬🇧 Fuerzas del Imperio Británico (ENG)
1. **Operación Battleaxe (Norte de África):**  
   👉 [http://127.0.0.1:8080/?m=map/single/03_eng-skirmish/01_eng-battleaxe&autoplay=1](http://127.0.0.1:8080/?m=map/single/03_eng-skirmish/01_eng-battleaxe&autoplay=1)  
   *Choque acorazado en las arenas del desierto libio y captura de pasos fortificados.*
2. **Operación Torch (Argelia/Túnez):**  
   👉 [http://127.0.0.1:8080/?m=map/single/03_eng-skirmish/02_eng-torch&autoplay=1](http://127.0.0.1:8080/?m=map/single/03_eng-skirmish/02_eng-torch&autoplay=1)  
   *Desembarco y toma de posiciones defensivas en el teatro del Mediterráneo.*
3. **Arnhem (Holanda):**  
   👉 [http://127.0.0.1:8080/?m=map/single/03_eng-skirmish/03_eng-arnhem&autoplay=1](http://127.0.0.1:8080/?m=map/single/03_eng-skirmish/03_eng-arnhem&autoplay=1)  
   *Resistencia encarnizada de los "Diablos Rojos" en el perímetro urbano del puente.*

---

### 🇷🇺 Fuerzas de la Unión Soviética (RUS)
1. **Smolensk (Frente Oriental):**  
   👉 [http://127.0.0.1:8080/?m=map/single/04_rus-skirmish/01_rus-smolensk&autoplay=1](http://127.0.0.1:8080/?m=map/single/04_rus-skirmish/01_rus-smolensk&autoplay=1)  
   *Batalla masiva de desgaste y ruptura en los bosques y trincheras rusas.*
2. **Königsberg (Prusia Oriental):**  
   👉 [http://127.0.0.1:8080/?m=map/single/04_rus-skirmish/02_rus-koenigsberg&autoplay=1](http://127.0.0.1:8080/?m=map/single/04_rus-skirmish/02_rus-koenigsberg&autoplay=1)  
   *Asalto a fortificaciones pesadas y asedio urbano con artillería pesada.*
3. **Manchuria (Extremo Oriente):**  
   👉 [http://127.0.0.1:8080/?m=map/single/04_rus-skirmish/03_rus-manchuria&autoplay=1](http://127.0.0.1:8080/?m=map/single/04_rus-skirmish/03_rus-manchuria&autoplay=1)  
   *Ofensiva relámpago combinada contra las defensas del ejército de Kwantung.*

---

### 🇯🇵 Fuerzas del Imperio del Japón (JAP)
1. **Khalkhin Gol (Frontera Mongolia/Manchuria):**  
   👉 [http://127.0.0.1:8080/?m=map/single/05_jap-skirmish/01_jap-khalkhingol&autoplay=1](http://127.0.0.1:8080/?m=map/single/05_jap-skirmish/01_jap-khalkhingol&autoplay=1)  
   *Guerra de trincheras en estepas abiertas y emboscadas nocturnas.*
2. **Singapur (Sudeste Asiático):**  
   👉 [http://127.0.0.1:8080/?m=map/single/05_jap-skirmish/02_jap-singapore&autoplay=1](http://127.0.0.1:8080/?m=map/single/05_jap-skirmish/02_jap-singapore&autoplay=1)  
   *Avance en la jungla y asalto anfibio a la fortaleza británica.*
3. **Iwo Jima (Pacífico):**  
   👉 [http://127.0.0.1:8080/?m=map/single/05_jap-skirmish/03_jap-iwojima&autoplay=1](http://127.0.0.1:8080/?m=map/single/05_jap-skirmish/03_jap-iwojima&autoplay=1)  
   *Defensa en redes de búnkeres subterráneos y ceniza volcánica contra el asalto de los marines.*

---

## 3. Controles Tácticos del Juego

El juego sigue el estándar táctico de estrategia en tiempo real de Men of War:

| Acción | Control | Descripción |
|---|---|---|
| **Mover Cámara** | `W`, `A`, `S`, `D` o Flechas | Desplazamiento por el mapa de combate. |
| **Girar Cámara** | `Q` / `E` | Rotación del ángulo azimutal de visión táctica. |
| **Zoom** | Rueda del ratón | Acercar o alejar la perspectiva aérea. |
| **Seleccionar Tropas** | Clic Izquierdo | Selecciona una unidad o pelotón individual. |
| **Selección Múltiple** | Arrastrar Recuadro | Selecciona todas las unidades dentro del recuadro. |
| **Orden de Movimiento** | Clic Derecho en Suelo | Envía a las tropas seleccionadas a la posición con búsqueda de caminos A*. |
| **Orden de Ataque** | Clic Derecho en Enemigo | Abre fuego balístico con penetración según blindaje y distancia. |
| **Pausa Táctica** | `Espacio` | Detiene o reanuda la simulación a voluntad. |
| **Velocidad de Simulación** | Botones `1x`, `2x`, `5x` | Acelera el paso del tiempo en el bucle determinista de 20 Hz. |
| **Navegación por Minimapa** | Clic Izquierdo en Minimapa | Salto instantáneo de la cámara a las coordenadas seleccionadas. |
| **IA Jugador-Bot** | Botón `BOT: OFF / DEFEND` | Permite que el bot asistente organice y defienda las banderas mientras el jugador ataca. |

---

## 4. Paneles de la Interfaz (HUD)

- **Barra Superior:** Muestra los **Puntos de Mando (MP)** disponibles (ganados pasivamente con el control de banderas), el recuento de banderas aliadas (★) frente a enemigas (✠), el cronómetro de la operación y el estado de la pausa.
- **Panel de Inspección:** Situado en la esquina inferior izquierda al seleccionar soldados o blindados. Muestra el nombre de la unidad, su barra de salud porcentual, botones de postura (`De pie`, `Agachado`, `Cuerpo a tierra`), modos de fuego (`Fuego libre`, `Respuesta`, `Alto el fuego`) y el equipo de a bordo.
- **Barra de Refuerzos:** Desplegable interactivo inferior que permite solicitar pelotones de infantería, ametralladoras pesadas, carros de combate ligeros, medios y pesados, respetando costes en MP y tiempos de enfriamiento (`delay`).
- **Minimapa Radar:** Canvas 2D en tiempo real con la imagen cartográfica original (`minimap.dds.png`), mostrando iconos de banderas y posiciones de combate de todas las unidades activas.
- **Modal de Victoria y Derrota:** Al asegurar todos los sectores clave se despliega la pantalla de victoria con fanfarria militar y opciones de reiniciar o volver al menú principal.

---

## 5. Verificación de Rendimiento y Cobertura Automatizada

El proyecto cuenta con un arnés de pruebas continuas que valida el 100% de los subsistemas y escenarios:

- **Ejecutar Suite de Pruebas:**
  ```powershell
  cd web
  npm test
  ```
  *(11 suites Vitest, 75 pruebas unitarias e integradas pasando al 100%).*

- **Generar Matriz de Cobertura de las 15 Escaramuzas:**
  ```powershell
  cd web
  npm run coverage
  ```
  *(Simula en modo headless cada una de las 15 misiones, verificando que los 15 mapas cargan al 100%, todas las entidades están colocadas, 0 triggers desconocidos, victoria y derrota alcanzables, y 0 errores de audio. Tabla registrada en `docs/COVERAGE.md`).*
