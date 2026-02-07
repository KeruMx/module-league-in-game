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

## ⚠️ Importante: Tracking de Oro (Gold)

### El oro NO se obtiene de la Riot API

La API de Live Client Data de Riot **NO proporciona datos de oro en modo espectador**. Por lo tanto, el tracking de oro requiere herramientas externas.

### Opciones para obtener datos de oro:

#### 1. FarsightData (Recomendado para producciones)

FarsightData es un lector de memoria que obtiene datos directamente del cliente de League of Legends. **No está incluido en este repositorio**.

**Para usar FarsightData:**

1. Instalar y configurar [league-observer-tool](https://github.com/RCVolus/league-observer-tool)
2. Asegurarse de que el módulo Farsight está corriendo en la PC del observador
3. El observer tool enviará eventos `farsight-data` a este módulo automáticamente

**Requisitos de FarsightData:**
- Ejecutar en la misma PC donde corre el cliente de LoL (observador)
- Los memory offsets deben estar actualizados para el parche actual de LoL
- Vanguard (anti-cheat de Riot) puede bloquear el lector de memoria

**Estructura de datos FarsightData esperada:**
```typescript
interface FarsightData {
   champions: Array<{
      name: string;
      displayName: string;
      team: number; // 100 = Blue, 200 = Red
      currentGold: number;
      totalGold: number;
      experience: number;
      level: number;
      // ... otros campos
   }>;
   gameTime: number;
   nextDragonType: string;
}
```

#### 2. Live Client API (Limitado)

En algunos modos de juego (no espectador), la Live Client API puede proporcionar datos de oro. Este módulo ya tiene implementado un fallback que intenta obtener oro de `allPlayers.totalGold` si está disponible.

## Eventos que consume este módulo

| Evento | Namespace | Descripción |
|--------|-----------|-------------|
| `allgamedata` | module-league-in-game | Datos de la Live Client API |
| `farsight-data` | module-league-in-game | Datos de FarsightData (oro, experiencia) |
| `live-events` | module-league-in-game | Eventos del juego (kills de dragón, barón, etc.) |

## Solución de problemas

### El oro no se muestra

1. **Verificar que FarsightData está corriendo** - El observer tool debe estar activo
2. **Verificar los memory offsets** - Después de cada parche de LoL, pueden necesitar actualización
3. **Verificar Vanguard** - El anti-cheat puede bloquear el lector de memoria
4. **Revisar logs** - Buscar errores relacionados con `farsight-data` en la consola

### Los eventos de dragón/barón no se muestran

Esto puede deberse a un problema con el matching de nombres de jugadores. Ver los cambios recientes que añaden fallback para `summonerName` además de `riotIdGameName`.

## Desarrollo

```bash
# Instalar dependencias
npm install

# Compilar
npm run build
```

## Licencia

MIT
