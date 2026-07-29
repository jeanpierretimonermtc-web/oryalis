-- Permettre plusieurs intentions commerciales simultanées sur un même RDV
-- (ex: "acheter produit" ET "devenir distributeur" en même temps).
-- Conversion de commercial_intent_enum -> commercial_intent_enum[] sur
-- appointment_business_context, en conservant les valeurs déjà en base :
-- une ligne NULL reste NULL, une valeur existante devient un tableau à un
-- seul élément (ARRAY[commercial_intent]).

ALTER TABLE public.appointment_business_context
  ALTER COLUMN commercial_intent TYPE commercial_intent_enum[]
  USING (
    CASE
      WHEN commercial_intent IS NULL THEN NULL
      ELSE ARRAY[commercial_intent]
    END
  );
