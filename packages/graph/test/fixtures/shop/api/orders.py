"""Orders API: the FastAPI route and the database read."""

import requests
from fastapi import APIRouter

router = APIRouter(prefix="/api/orders")


def load_row(order_id: str) -> dict:
    return {"id": order_id}


def get_order_by_id(order_id: str) -> dict:
    row = load_row(order_id)
    return row


@router.get("/{order_id}")
def get_order(order_id: str) -> dict:
    return get_order_by_id(order_id)


def fetch_remote(url: str) -> dict:
    return requests.get(url).json()
