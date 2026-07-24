-- Distinguish customer orders from the advisor's own personal orders (Phase 2.2 of the vision roadmap).
-- "returned" is added to OrderStatus at the application level only — status has no CHECK
-- constraint in this table, matching the existing convention.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'customer';

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_order_type_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_order_type_check
  CHECK (order_type IN ('customer', 'personal'));
