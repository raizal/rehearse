from orders import get_order_by_id


def test_get_order_by_id():
    assert get_order_by_id("1") == {"id": "1"}
