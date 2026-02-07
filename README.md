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

### Prioridad de fuentes de oro:
1. **FarsightData** (si está recibiendo datos) → Más preciso pero riesgoso
2. **Live Client API** (si proporciona oro) → Preciso y seguro
3. **Estimación** (fallback automático) → Aproximado y seguro

## Eventos que consume este módulo

| Evento | Namespace | Descripción |
|--------|-----------|-------------|
| `allgamedata` | module-league-in-game | Datos de la Live Client API |
| `farsight-data` | module-league-in-game | Datos de FarsightData (oro, experiencia) - opcional |
| `live-events` | module-league-in-game | Eventos del juego (kills de dragón, barón, etc.) |

## Solución de problemas

### El oro no se muestra

1. **Verifica que el módulo esté recibiendo datos** - Revisa los logs del toolkit
2. **Modo estimación activo** - Si ves "estimation mode" en los logs, el sistema está estimando el oro (no es un error)
3. **FarsightData bloqueado** - Si usas FarsightData, Vanguard puede estar bloqueándolo

### Los eventos de dragón/barón no se muestran

Esto puede deberse a un problema con el matching de nombres de jugadores. El módulo busca jugadores por `riotIdGameName` y `summonerName`.

## Desarrollo

```bash
# Instalar dependencias
npm install

# Compilar
npm run build
```

## Licencia

MIT
