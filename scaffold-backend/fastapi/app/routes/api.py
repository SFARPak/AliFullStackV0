from fastapi import APIRouter, HTTPException
from ..schemas import Item, ItemCreate

router = APIRouter()

# In-memory storage for demo purposes
# In production, use a proper database
items_db = []
item_id_counter = 1

@router.get("/items", response_model=list[Item])
async def get_items():
    """Get all items"""
    return items_db

@router.get("/items/{item_id}", response_model=Item)
async def get_item(item_id: int):
    """Get a specific item by ID"""
    for item in items_db:
        if item.id == item_id:
            return item
    raise HTTPException(status_code=404, detail="Item not found")

@router.post("/items", response_model=Item)
async def create_item(item: ItemCreate):
    """Create a new item"""
    global item_id_counter
    new_item = Item(id=item_id_counter, **item.model_dump())
    items_db.append(new_item)
    item_id_counter += 1
    return new_item

@router.put("/items/{item_id}", response_model=Item)
async def update_item(item_id: int, item: ItemCreate):
    """Update an existing item"""
    for i, existing_item in enumerate(items_db):
        if existing_item.id == item_id:
            updated_item = Item(id=item_id, **item.model_dump())
            items_db[i] = updated_item
            return updated_item
    raise HTTPException(status_code=404, detail="Item not found")

@router.delete("/items/{item_id}")
async def delete_item(item_id: int):
    """Delete an item"""
    for i, item in enumerate(items_db):
        if item.id == item_id:
            del items_db[i]
            return {"message": "Item deleted successfully"}
    raise HTTPException(status_code=404, detail="Item not found")