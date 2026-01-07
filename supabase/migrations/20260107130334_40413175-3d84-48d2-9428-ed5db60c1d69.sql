-- Add is_active column to purchase_items for soft delete
ALTER TABLE public.purchase_items 
ADD COLUMN is_active boolean NOT NULL DEFAULT true;

-- Create index for better query performance
CREATE INDEX idx_purchase_items_is_active ON public.purchase_items(is_active);

-- Update RLS policy to only show active items (drop and recreate)
DROP POLICY IF EXISTS "Users can view own purchase items" ON public.purchase_items;

CREATE POLICY "Users can view own purchase items" 
ON public.purchase_items 
FOR SELECT 
USING (
  is_active = true AND
  EXISTS (
    SELECT 1 FROM purchase_history
    WHERE purchase_history.id = purchase_items.purchase_id 
    AND purchase_history.user_id = auth.uid()
  )
);

-- Add UPDATE policy for purchase_items so we can soft delete
CREATE POLICY "Users can update own purchase items" 
ON public.purchase_items 
FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM purchase_history
    WHERE purchase_history.id = purchase_items.purchase_id 
    AND purchase_history.user_id = auth.uid()
  )
);