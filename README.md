# Al Toque - UPCH Campus

Aplicacion Node.js para pedidos, chat y Reels. El servidor sirve la interfaz y
las rutas `/api`; no se puede alojar como una pagina estatica en GitHub Pages.

## Desarrollo local

- Requiere Node.js 20.6 o posterior.
- Ejecuta `npm start` y abre `http://localhost:4173`.
- Copia `.env.example` a `.env` para configurar integraciones opcionales.
- Define `REELS_DELETE_PASSWORD` con una clave privada para habilitar la
  eliminacion de Reels. Sin ella, esa operacion falla de forma cerrada.

## Despliegue en Render

El archivo `render.yaml` configura un servicio web Node con disco persistente.
Al crear el servicio desde este repositorio, Render pedira `REELS_DELETE_PASSWORD`;
configura ahi una clave fuerte y privada. No la guardes en Git ni la compartas.

El disco conserva los pedidos y Reels nuevos bajo `/var/data`. Los historiales
locales y videos existentes no se incluyen en el repositorio ni se migran.
Configura las claves opcionales de `.env.example` en el panel de Render si
necesitas esas integraciones.
