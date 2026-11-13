-- Migration: agregar columna id_talla a detallecompra (opcional)
-- Ejecuta esto en tu base de datos si deseas que las compras con tallas se registren en detallecompra.
-- Haz backup antes de ejecutar: mysqldump -u <user> -p MAX > backup.sql

ALTER TABLE detallecompra
  ADD COLUMN IF NOT EXISTS id_talla INT NULL;

-- Crear índice para consultas por talla
CREATE INDEX IF NOT EXISTS idx_detallecompra_id_talla ON detallecompra (id_talla);

-- Agregar FK opcional (si existe la tabla tallas)
ALTER TABLE detallecompra
  ADD CONSTRAINT IF NOT EXISTS fk_detallecompra_talla
  FOREIGN KEY (id_talla) REFERENCES tallas(id_talla)
  ON DELETE SET NULL ON UPDATE CASCADE;
