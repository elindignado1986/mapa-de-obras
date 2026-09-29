# Mapa de sombras · AMBA

La entrada principal es ahora el **Explorador de Obras**. El **Simulador de Obras** existente continúa disponible desde la navegación y `/#simulador`; sus enlaces y guardado local se conservan. El registro público requiere Redis, Blob privado y un worker separado. Sin esos servicios, la aplicación informa la falta de configuración y mantiene operativo el simulador. Ver [implementación, configuración y validación del Explorador](docs/WORKS-EXPLORER.md).

Simulador comunitario de asoleamiento con 77.651 parcelas de Tres de Febrero. También está habilitado Hurlingham, con 44.162 parcelas; Castelar se ofrece como localidad dentro de Morón; el resto de Morón y los demás municipios permanecen deshabilitados.

## Ejecutar

Requiere Node.js 22 o superior y npm. En PowerShell con scripts deshabilitados, usar `npm.cmd`.

```sh
npm ci
npm run dev
```

Abrir `http://localhost:4173`. `npm run dev` construye y sirve la aplicación. Reejecutar el build después de editar módulos. No abrir con `file://`: los datos se cargan por HTTP.

Los datos descargados ya están preparados en este workspace. En un clon nuevo, los crudos/celdas no vienen en Git: seguir [ARBA-DATA](docs/ARBA-DATA.md) para generar los dos pilotos o importar manualmente. Sin esos datos no se pueden seleccionar parcelas. No se requiere ARBA al usar la app después de procesar los archivos.

```sh
npm run data:fetch -- tres-de-febrero moron
node scripts/process-parcels.mjs tres-de-febrero
node scripts/process-parcels.mjs moron
```

El archivo de Morón del 13/11/2025 contiene un registro fuera del AMBA. Tras revisar su informe, procesarlo con `--allow-quarantine`, como se documenta. No ignorar nuevos rechazos sin inspección.

## Uso

La app inicia en planta mostrando todo Tres de Febrero. Buscar una dirección muestra un punto rojo; las coincidencias aproximadas se identifican. Seleccionar una o varias parcelas que compartan un lado (hasta 16), indicar pisos —unidad inicial, 3,375 m por piso (8 pisos = 27 m)— o metros y generar el volumen directamente. No hay dibujo libre.

La vista 3D se habilita al generar el volumen, con perspectiva equivalente a 32 mm y giro centrado en la construcción. En planta, arrastrar desplaza; en 3D, arrastrar gira. Los enlaces compartidos también abren en planta. Guardado local disponible desde el pie.

Calles, estaciones y parques de OpenStreetMap acompañan el catastro ARBA en ambas vistas. Google Híbrido queda visible como opción deshabilitada para una integración futura; todavía no está conectado. Ver [Contexto cartográfico](docs/MAP-CONTEXT.md).

## Verificar

```sh
npm test
npm run build
npm run test:browser
```

La prueba de navegador requiere servidor activo en 4173 y Chrome; configurar `CHROME_PATH` en otros sistemas. Prueba escritorio y móvil emulado: inicio general, parcelas contiguas, marcador, altura, perspectiva, enlaces y controles deshabilitados. Capturas y resultados quedan en `.checks/`.

## Publicación

`npm run build` genera `publicar/`; Vercel está configurado en `vercel.json`. **No se hizo deploy. Antes de publicar datos derivados, revisar las condiciones de redistribución ARBA**, todavía no documentadas de forma inequívoca. El build muestra una advertencia si esa revisión sigue pendiente. Preparar/subir los datos al hosting propio como parte del despliegue; los directorios ignorados no viajan con Git. Los crudos y la información tributaria no se incorporan al frontend.

El contador/votación requiere Redis REST opcional y variables `COMMUNITY_REDIS_URL`, `COMMUNITY_REDIS_TOKEN`, `COMMUNITY_ORIGIN`. Sin ellas la aplicación funciona sin contadores ficticios. El enlace de apoyo a Cafecito está en la cabecera; la publicidad permanece desactivada.

## Alcance y pendientes de validación

El piloto muestra catastro y contexto de calles de Tres de Febrero y Hurlingham. Photon es un proveedor desacoplado de búsqueda basado en OSM, de disponibilidad limitada; requiere dimensionamiento antes de difusión masiva. No se simula normativa, mensura ni edificabilidad. Sombras sobre plano horizontal, sin terreno ni obstrucciones vecinas.

La prueba mobile es emulada, no una certificación en iPhone/Android físicos. Falta revisión geográfica independiente contra mensuras y autorización de redistribución. Tres municipios fueron procesados; Tres de Febrero y Hurlingham están habilitados.

Documentación: [Arquitectura](docs/ARCHITECTURE.md) · [Datos ARBA](docs/ARBA-DATA.md) · [Compartir](docs/SHARING.md).

[Datos y validación de Hurlingham](docs/HURLINGHAM.md).

[Datos, límite y validación de Castelar](docs/CASTELAR.md).

San Isidro: 69.271 parcelas ARBA habilitadas. Ver [datos y validacion](docs/SAN-ISIDRO.md).
