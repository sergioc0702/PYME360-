# Referencias estadísticas oficiales

El servidor usa este contrato CSV para agregar tablas oficiales publicadas por DANE/EAI, Superservicios/SUI y EIA/MECS. No se descargan ni se transforman automáticamente los XLSX de esos portales: cada fila debe ser revisada y transformada a la unidad y periodo declarados antes de incorporarla.

Al instalar Pyme360, el servidor copia el archivo de plantilla a la carpeta local de datos:

- Windows: %LOCALAPPDATA%\Pyme360\benchmarks\official_snapshots.csv
- macOS: ~/Library/Application Support/Pyme360/benchmarks/official_snapshots.csv
- Linux: $XDG_DATA_HOME/pyme360/benchmarks/official_snapshots.csv o ~/.local/share/pyme360/benchmarks/official_snapshots.csv

Edita ese archivo con un editor de hojas de cálculo y guárdalo como CSV UTF-8. Conserva la URL de origen, el periodo publicado, la unidad y el alcance. Usa comparability=direct solo cuando coincidan recurso, unidad, denominador, sector y periodo con el perfil de empresa; de lo contrario usa contextual. El archivo se valida completo antes de aceptar sus registros.

Valores admitidos para source_id: dane-eai, sui-energy, eia-mecs. La aplicación no infiere unidades ni factores faltantes. Las filas que no puedan compararse de forma segura deben conservarse como contextual o excluirse.
