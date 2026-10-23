# War of Men [WWII Tactical RTS & Direct Control] — Roblox Studio Port

Port completo y 100% jugable en **Luau** para **Roblox Studio** de *OpenMoW-Web* (*Men of War: Assault Squad 2*), con simulación balística **GEM2**, cámara híbrida **RTS + Control Directo en 3ra Persona (`[TAB]`)**, **5 facciones**, **15 escaramuzas**, **27 unidades de infantería y blindados**, e **IA Comandante + Player-Bot Cooperativo**.

---

## 🌐 Enlaces Oficiales en Roblox Cloud (`dominusbabl`)

- **Nombre de la Experiencia:** `War of Men [WWII Tactical RTS & Direct Control]`
- **UniverseId:** `10772595182`
- **RootPlaceId:** `133837357200651` (`RevisionId: 3`, `hasPublishedVersion: true`, `Moderation: Approved`, `State: Active`)
- **Página del Juego en Roblox:** [https://www.roblox.com/games/133837357200651/War-of-Men](https://www.roblox.com/games/133837357200651/War-of-Men)
- **Panel de Creador (Creator Dashboard):** [https://create.roblox.com/dashboard/creations/experiences/10772595182/overview](https://create.roblox.com/dashboard/creations/experiences/10772595182/overview)

---

## 🖼️ Activos Multimedia Oficiales Cargados

| Activo | Archivo Local | Resolución | Roblox Cloud Target ID | Estado |
|---|---|---|---|---|
| **Icono Oficial** | `assets/WarOfMen_Icon_512x512.png` | `512x512` | `3675024097979831` | `HTTP 200 OK` |
| **Miniatura 1 (Normandía)** | `assets/WarOfMen_Thumb_1_Normandy.png` | `1920x1080` | `6595146786447116` | `HTTP 200 OK` |
| **Miniatura 2 (Choque Blindado)** | `assets/WarOfMen_Thumb_2_ArmorClash.png` | `1920x1080` | `8648214195286318` | `HTTP 200 OK` |
| **Miniatura 3 (Direct Control)** | `assets/WarOfMen_Thumb_3_DirectControl.png` | `1920x1080` | `6547484678710335` | `HTTP 200 OK` |
| **Tráiler Oficial MP4** | `assets/WarOfMen_Trailer_1080p.mp4` | `1920x1080` @ 30fps | H.264 + AAC Audio | Listo |

---

## 🧱 Arquitectura Luau (`src/`)

1. **`src/Shared/WarOfMenCatalog.luau`**:
   - Catálogo táctico compartido con las **5 facciones** (`USA`, `GER`, `ENG`, `RUS`, `JAP`), **15 misiones históricas**, **27 armas con tablas de penetración GEM2 (`d10`, `d50`, `d100`, `d200`)**, **27 plantillas de unidades** con blindaje direccional (`front`, `side`, `rear`, `top`) y **20 tarjetas de refuerzos (MP)**.
2. **`src/Shared/NetProtocol.luau`**:
   - Bus de red dual que opera sobre `RemoteEvent` (`ReplicatedStorage.WarOfMenRemotes`) en servidores/Play Mode y sobre `BindableEvent` en el visor en vivo de Roblox Studio.
3. **`src/Server/BallisticsCombatService.luau`**:
   - Motor balístico GEM2: ángulo de impacto sobre blindaje direccional, rebote automático a $\ge 70^\circ$ (`RICOCHET`), comparación de penetración efectiva (`PENETRATED`, `PARTIAL`, `BOUNCED`), modificadores de postura (`stand`, `crouch`, `prone`), cobertura tras sacos terreros y explosiones HE.
4. **`src/Server/WorldSimService.luau`**:
   - Generador 3D del campo de batalla (`Workspace.WarOfMenBattlefield`): terreno por bioma, río, puente central, vados norte y sur, búnkeres de hormigón, trincheras de sacos terreros, árboles, 3 puntos estratégicos con `BillboardGui` y modelos 3D articulados de infantería y tanques con torreta móvil y restos humeantes (`Wrecks`).
5. **`src/Server/TacticalAIService.luau`**:
   - IA Comandante del Eje (`Team 1`) que despliega refuerzos y captura banderas + IA `Player-Bot` (`OFF / DEFEND / ATTACK`) para asistir al jugador.
6. **`src/Server/ProfileStoreService.luau`**:
   - Persistencia en `DataStoreService` (`WarOfMen_CommanderProfile_v1`) de rango militar, XP, victorias, bajas y blindados destruidos.
7. **`src/Server/GameServer.server.luau`**:
   - Bucle autoritativo a 20 Hz.
8. **`src/Client/WarOfMenClient.client.luau`**:
   - Cámara orbital RTS (`WASD`, rueda de ratón, `Q/E`), **Modo Direct Control en 3ra persona (`[TAB]`)**, selección múltiple (*Marquee Box*), órdenes con clic derecho, trazadores luminosos, textos flotantes de impacto, minimapa radar interactivo, selector de 15 misiones y dock inferior de 20 refuerzos.
