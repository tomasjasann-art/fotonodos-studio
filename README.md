# FotoNodos Studio

Aplicación web independiente de Logística F1. Repositorio: https://github.com/tomasjasann-art/fotonodos-studio

## Editor fotográfico
- Cada foto guarda sus propios datos: nodo, fecha, hora, coordenadas, recorte, logo YOFC, ajustes y rótulo.
- OCR local con Tesseract.js para detectar texto y localizar la región del rótulo.
- Edición convencional con Canvas y descarga individual o ZIP con el nombre del nodo.
- Edición generativa por OpenAI bajo demanda: panel **✦ Editor IA**, instrucciones en lenguaje natural y máscara de área.
- Modo **Reemplazar rótulo**: la IA reconstruye el fondo sin texto. El aplicativo dibuja los campos exactos sobre la zona limpiada.
- Modo **Editar la zona**: envía únicamente la región seleccionada y conserva los píxeles exteriores al combinar el resultado.
- Modo **Fotografía completa**: permite modificaciones generales bajo instrucción explícita.
- Conserva el original y permite deshacer una edición con IA. Los ZIP que incluyen IA agregan \`FotoNodos_historial_ediciones.json\`.

## Activar las ediciones con IA
1. En Vercel, abre el proyecto **fotonodos-studio-github**.
2. En **Settings > Environment Variables** añade **OPENAI_API_KEY** como variable *Sensitive* (producción). Crea tu clave en https://platform.openai.com/api-keys. La suscripción de ChatGPT no incluye automáticamente créditos API.
3. Añade **FOTONODOS_AI_PASSWORD** como otra variable *Sensitive* de producción, usando una contraseña larga y exclusiva para este aplicativo.
4. Re-despliega la rama \`main\` en Vercel para que las funciones lean las variables.
5. Abre https://fotonodos-studio-github.vercel.app, elige una foto y la pestaña **✦ Editor IA**. Escribe la instrucción, introduce la contraseña de acceso y pulsa **Interpretar y generar edición con IA**.

Nunca escribas la clave \`OPENAI_API_KEY\` en el navegador, en GitHub ni en este archivo. La contraseña de acceso del usuario no es la clave de OpenAI.

## Implementación
Frontend: HTML/CSS/JS local. API: Vercel Node Functions (\`api/edit.js\`, \`api/interpret.js\`). Servicios: \`gpt-image-2.5-sunburst\` para inpainting y \`gpt-5.4-mini\` para interpretar modificaciones de datos. Las fotos no se almacenan en una base de datos; solo se envía la fotografía seleccionada a OpenAI al pulsar el botón de IA.

### Límites
Vercel Functions limita las solicitudes y respuestas a 4.5 MB. El navegador reduce la fotografía enviada a la IA, combina la edición en la foto original y exporta al tamaño original, aunque el área generada por IA tenga menos detalle. La precisión de la reconstrucción varía con el tipo de superficie y el texto. Se recomienda revisar el resultado antes de descargarlo.

**Fotografías de inspección:** las modificaciones son digitales y no acreditan que la captura haya ocurrido en otra fecha. Mantén el original y el historial de cambios para fines de auditoría.

### Seguridad y gastos
- Los endpoints de IA requieren ambas variables de entorno y una contraseña con comparación constante.
- La clave de OpenAI se utiliza solo del lado servidor; no se expone al navegador.
- No hay almacenamiento permanente de las fotos en FotoNodos.
- La API de OpenAI tiene consumo y facturación independiente. Revisa los límites de gasto y tasas de uso en tu cuenta de OpenAI.
- Para usar públicamente con múltiples usuarios, añade control de acceso individual, rate limiting persistente, límites de presupuesto por usuario y monitoreo antes de habilitar la clave.
