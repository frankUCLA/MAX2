-- MAX: dirección del cliente
ALTER TABLE `clientes`
  ADD COLUMN IF NOT EXISTS `direccion` VARCHAR(255) NULL DEFAULT NULL AFTER `telefono`;
