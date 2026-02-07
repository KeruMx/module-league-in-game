# Module League In-Game

Módulo para mostrar información en tiempo real durante partidas de League of Legends.

## Requisitos

Este módulo es parte del ecosistema **league-prod-toolkit** y requiere:

- `module-league-state` - Gestión del estado de la partida
- `module-league-static` - Datos estáticos de LoL (campeones, items, etc.)

## Características

- Mostrar estadísticas de jugadores (nivel, items, KDA)
- Killfeed en tiempo real
- Contador de dragones, barones y heraldos
- Gráfico de diferencia de oro
- Tablero de inhibidores

## 🐉 Eventos de Objetivos (Dragones, Baron, Heraldo)

### ✅ Implementación usando Live Client Data API

Los eventos de dragones, barón y heraldo **están completamente implementados** usando la [Live Client Data API](https://developer.riotgames.com/docs/lol#game-client-api_live-client-data-api) oficial de Riot.

**Eventos soportados:**
- `DragonKill` - Todos los tipos: Fire, Earth, Water, Air, Hextech, Chemtech, Elder
- `BaronKill` - Nashor Baron
- `HeraldKill` - Rift Herald

### Cómo funcionan los eventos

El módulo procesa automáticamente los eventos del array `events.Events` que viene en `allgamedata`:

```json
{
  "EventName": "DragonKill",
  "EventTime": 310.36,
  "DragonType": "Fire",
  "KillerName": "SummonerName",
  "Stolen": "False",
  "Assisters": ["Player1", "Player2"]
}
```

### ⏱️ Timers de Respawn (Baron/Elder)

El módulo incluye timers de respawn para Baron y Elder Dragon que se activan automáticamente cuando se mata el objetivo.

**Configuración requerida:**
```typescript
config.ppTimer = true  // Habilitar timers de power play
```

**El timer muestra:**
- Tiempo restante hasta respawn (3 minutos para Baron/Elder)
- Porcentaje de tiempo restante
- Diferencia de oro durante el power play

### Configuración de eventos

Para habilitar los eventos, asegúrate de que `config.events` incluya los tipos deseados:

```typescript
config.events = ['Dragons', 'Barons', 'Heralds']
```

## 🪙 Tracking de Oro (Gold)

### Métodos disponibles (en orden de prioridad):

#### 1. Live Client API (Cuando está disponible)
En algunos modos de juego, la Live Client API proporciona datos de oro directamente (`totalGold`, `currentGold`). El módulo usa estos datos automáticamente cuando están disponibles.

#### 2. ⭐ Estimación de Oro (NUEVO - Alternativa Segura)
**Esta es la alternativa segura que no requiere lectura de memoria y no tiene riesgo de ban.**

Cuando la Live Client API no proporciona oro (modo espectador), el módulo ahora **estima el oro automáticamente** basándose en:

- **Oro pasivo**: ~1 oro por segundo
- **CS (Creep Score)**: ~19 oro promedio por minion/monstruo
- **Kills**: 300 oro base por kill
- **Asistencias**: ~150 oro por asistencia
- **Items**: Valor de los items comprados

**Fórmula de estimación:**
```
Oro Total ≈ 500 (inicial) + (tiempo × 1) + (CS × 19) + (kills × 300) + (assists × 150)
Oro Actual ≈ Oro Total - Valor de Items
```

⚠️ **Nota**: La estimación no es 100% precisa (no incluye objetivos, placas de torre, bounties, etc.), pero proporciona una aproximación razonable sin ningún riesgo de ban.

#### 3. FarsightData (⚠️ RIESGO DE BAN)
FarsightData usa lectura de memoria, lo cual **puede resultar en baneos** debido al anti-cheat Vanguard de Riot. 

**No se recomienda usar FarsightData** a menos que sea absolutamente necesario y estés dispuesto a asumir el riesgo.

Si aún deseas usarlo:
1. Instalar [league-observer-tool](https://github.com/RCVolus/league-observer-tool)
2. El observer tool enviará eventos `farsight-data` a este módulo

### Cómo funciona (orden de ejecución):

1. **FarsightData** (evento separado) → Si se reciben datos de `farsight-data`, se usan directamente
2. **Live Client API** → Cuando se procesan `allgamedata`, el módulo verifica si hay datos de oro
3. **Estimación** (fallback automático) → Si no hay datos de oro de la API, estima automáticamente

**Orden de precisión (de mejor a peor):**
- FarsightData → Más preciso (datos reales de memoria) pero ⚠️ riesgo de ban
- Live Client API → Preciso y seguro (cuando está disponible)
- Estimación → Aproximado pero 100% seguro

## Eventos que consume este módulo

| Evento | Namespace | Descripción |
|--------|-----------|-------------|
| `allgamedata` | module-league-in-game | Datos de la Live Client API (incluye eventos de objetivos) |
| `farsight-data` | module-league-in-game | Datos de FarsightData (oro, experiencia) - opcional |
| `live-events` | module-league-in-game | Eventos del juego desde otros módulos |

## Solución de problemas

### El oro no se muestra

1. **Verifica que el módulo esté recibiendo datos** - Revisa los logs del toolkit
2. **Modo estimación activo** - Si ves "estimation mode" en los logs, el sistema está estimando el oro (no es un error)
3. **FarsightData bloqueado** - Si usas FarsightData, Vanguard puede estar bloqueándolo

### Los eventos de dragón/barón no se muestran

1. **Verifica que `config.events` incluya 'Dragons' y/o 'Barons'**
2. **Verifica que `allgamedata` incluya el array `events.Events`**
3. **El módulo busca jugadores por `riotIdGameName` y `summonerName`** - Si no encuentra el killer, no puede determinar el equipo

### Los timers de respawn no aparecen

1. **Verifica que `config.ppTimer = true`**
2. **Los timers solo se muestran para Baron y Elder Dragon**
3. **El timer se activa cuando se mata el objetivo, no antes**

## Desarrollo

```bash
# Instalar dependencias
npm install

# Compilar
npm run build
```

## Licencia

MIT
