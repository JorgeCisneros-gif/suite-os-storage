/**
 * Apps cliente válidas para el Storage Gateway.
 *
 * Cada string aquí representa una app de Suite-OS que puede usar
 * el gateway. Cuando agregues una nueva app (ej. ParkingOS),
 * añádela aquí.
 *
 * Se mantiene en archivo separado para que sea reutilizable
 * entre DTOs sin importar entidades.
 */
export const VALID_APP_SOURCES = [
  'departmentos',
  'inventoryos',
] as const;

export type AppSource = (typeof VALID_APP_SOURCES)[number];

/**
 * Tipos de entidad válidos a los que puede pertenecer un archivo.
 *
 * Los tipos son strings libres para no acoplar el gateway a las
 * entidades específicas de cada app cliente. Cada cliente decide
 * sus propios entityTypes.
 *
 * Ejemplos esperados:
 * - 'meter_reading'  → DepartmentOS, foto del medidor
 * - 'receipt'        → DepartmentOS, recibo de servicio
 * - 'expense_proof'  → DepartmentOS, comprobante de gasto
 * - 'product_photo'  → InventoryOS, foto de producto
 *
 * Solo validamos formato (lowercase + underscores) para mantener
 * consistencia.
 */
export const ENTITY_TYPE_REGEX = /^[a-z][a-z0-9_]{0,49}$/;
