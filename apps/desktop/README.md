# Endpoint Quality — app de escritorio

La app completa en una ventana nativa para **macOS**, **Windows** y **Linux**: el proceso
principal de Electron arranca el mismo API local que `eq serve` (SQLite, credenciales cifradas,
corridas en segundo plano, sincronización con la nube) y muestra la web que sirve. No hace falta
Node ni terminal.

| Sistema | Instalador |
|---|---|
| macOS (Apple Silicon e Intel) | `endpoint-quality-<versión>-mac-<arch>.dmg` (y `.zip`) |
| Windows | `endpoint-quality-<versión>-win-x64.exe` (NSIS, permite elegir carpeta) |
| Linux | `endpoint-quality-<versión>-linux-x86_64.AppImage` y `.deb` |

Cada release (tag `v*`) los construye en CI, cada uno en su sistema (`.github/workflows/release.yml`).

## Datos

- Los mismos que la CLI: `~/.endpoint-quality` (`EQ_DATA_DIR` para cambiarlo). Un proyecto creado
  en la app aparece en `eq` y al revés.
- Escucha solo en `127.0.0.1:4400` (`EQ_PORT` para cambiarlo). Si `eq serve` ya corre en ese puerto,
  la ventana se abre sobre él en lugar de arrancar un segundo API sobre la misma base. Si el puerto
  lo ocupa otra cosa, usa uno libre (las preferencias de la interfaz se guardan por puerto).
- Cerrar la app detiene el API y las corridas en curso. En macOS cerrar la ventana no cierra la
  app: el icono del Dock abre otra.
- Los enlaces externos (documentación, URLs de contratos) se abren en el navegador del sistema.

## Desarrollo

```bash
pnpm desktop          # compila (web + API + proceso principal) y abre la app
pnpm desktop:dist     # además empaqueta el instalador de este sistema en apps/desktop/release
```

`scripts/build.mjs` construye primero el bundle de la CLI (`apps/cli/dist`: web, ejemplos, SQLite
WebAssembly) y empaqueta `src/main.ts` con las mismas opciones de esbuild
(`apps/cli/scripts/esbuild-shared.mjs`); `--reuse` se salta el bundle de la CLI si ya existe.
`electron-builder.yml` define los instaladores. No hay módulos nativos: todo va en `dist/`.

## Actualizaciones

Al arrancar, la app instalada consulta una vez la última release de GitHub
(`publish` en `electron-builder.yml`, `src/updates.ts`). Nunca en desarrollo (`pnpm desktop`) ni
con `EQ_NO_UPDATE_CHECK=1`. Si hay una versión nueva, avisa con una notificación del sistema, sin
diálogos ni interrupciones:

- **Windows** y **Linux** (`.AppImage`, `.deb`): la descarga en segundo plano y la instala al
  cerrar la app.
- **macOS**: solo avisa; la notificación abre la página de la release. Squirrel.Mac solo instala
  actualizaciones firmadas con un Developer ID, y la build se firma ad hoc (ver Firma). Con un
  Developer ID, la actualización en sitio funciona sin más cambios que quitar esa excepción en
  `src/updates.ts`.

La release publica junto a los instaladores los `latest*.yml` y los `.blockmap` que lee la
consulta; los dos `latest-mac.yml` (arm64 y x64) se combinan en uno
(`scripts/merge-latest-mac.mjs`).

## Firma

- **macOS**: firma ad hoc, suficiente para ejecutarla en el equipo donde se construye. Un `.dmg`
  descargado de internet sin Developer ID muestra el aviso de Gatekeeper ("dañada" o "no se puede
  abrir"); para distribuirlo, añade un certificado Developer ID y notarización
  (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`… en CI) y quita `identity: "-"`. Mientras tanto:
  `xattr -dr com.apple.quarantine "/Applications/Endpoint Quality.app"`.
- **Windows**: sin firmar, SmartScreen avisa la primera vez ("Más información → Ejecutar de todas
  formas"). Con un certificado, `CSC_LINK`/`CSC_KEY_PASSWORD` lo firman.
- **Linux**: no requiere firma. El `.AppImage` necesita `chmod +x`.
