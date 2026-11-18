"""Two ordered WHO result slots; legacy single-result records remain slot 1."""
from app.core.exceptions import ValidationErrorException


def results_by_slot(selected):
    if len(selected) > 2:
        raise ValidationErrorException("Mỗi phiếu nhận tối đa hai kết quả giải phẫu bệnh WHO (1 và 2).")
    result = {}
    for index, node in enumerate(selected):
        slot = (node.get("slot") if isinstance(node, dict) else node.slot) or index + 1
        if slot not in (1, 2) or slot in result:
            raise ValidationErrorException("Vị trí kết quả WHO không hợp lệ hoặc bị trùng.")
        result[slot] = node
    return result
