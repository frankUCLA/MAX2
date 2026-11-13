-- MAX — actualizar textos de licencia demo a marca MAX
-- Ejecutar en la misma base (MAX u otra configurada en .env)

UPDATE licencias
SET cliente = 'Cliente MAX',
    notas = 'Licencia Plan Básico (hasta 2 cajas)'
WHERE token_licencia = 'MODA-BASIC-DEMO-0001'
   OR cliente LIKE '%Demo Modasoft%'
   OR cliente LIKE '%Modasoft%';

UPDATE licencias
SET token_licencia = 'MAX-BASIC-0001'
WHERE token_licencia = 'MODA-BASIC-DEMO-0001';
