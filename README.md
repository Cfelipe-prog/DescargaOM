# Automatizador OM

Aplicacion local en Vite + React con backend Express y Playwright para generar informes de varias OMs desde Arauco y guardarlos en PDF.

## Uso

1. Instala dependencias con `npm install`.
2. Copia `.env.example` a `.env` si quieres dejar credenciales por defecto.
3. Ejecuta `npm run dev`.
4. Abre `http://localhost:5173`.

## Coolify

1. Sube este proyecto a un repositorio Git.
2. En Coolify crea una aplicacion nueva desde repositorio.
3. Selecciona `Dockerfile` como metodo de build.
4. Usa el puerto `3001`.
5. Define estas variables:
   - `PORT=3001`
   - `OM_ARCGIS_USER=tu_usuario`
   - `OM_ARCGIS_PASSWORD=tu_password`
6. Agrega un volumen persistente montado en `/app/output` si quieres conservar archivos mientras no se descarguen.

## Flujo

- La interfaz recibe varias OMs.
- El backend inicia sesion en ArcGIS.
- Cada OM se envia al servicio `ReporteOMCIMA`.
- Cuando el HTML del informe esta listo, se exporta a PDF en `output/<id-del-lote>/`.
