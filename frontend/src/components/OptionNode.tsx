import React from "react";
import { FormOption } from "../types/schema";

interface OptionNodeProps {
  node: FormOption;
  depth?: number;
  selectedIds: Set<string>;
  otherTexts: Record<string, string>;
  onToggle: (node: FormOption, isChecked: boolean) => void;
  onOtherTextChange: (nodeId: string, text: string) => void;
}

export const OptionNode: React.FC<OptionNodeProps> = ({
  node,
  depth = 0,
  selectedIds,
  otherTexts,
  onToggle,
  onOtherTextChange,
}) => {
  const isSelected = selectedIds.has(node.id);
  const hasChildren = node.children && node.children.length > 0;
  const isOther = Boolean(node.has_other_text);

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onToggle(node, e.target.checked);
  };

  return (
    <div className="option-wrapper" data-depth={depth}>
      <label className="option-row">
        <input
          type="checkbox"
          id={`opt-${node.id}`}
          checked={isSelected}
          onChange={handleCheckboxChange}
          aria-expanded={hasChildren ? isSelected : undefined}
        />
        <span className="option-label">{node.label}</span>
      </label>

      {/* "Khác" text input (appears immediately when checked) */}
      {isOther && isSelected && (
        <div className="other-input-container">
          <input
            type="text"
            className="other-text-input"
            placeholder={node.other_placeholder || "Vui lòng ghi rõ"}
            value={otherTexts[node.id] || ""}
            onChange={(e) => onOtherTextChange(node.id, e.target.value)}
            autoFocus
          />
        </div>
      )}

      {/* Children container: rendered immediately below parent only when parent is selected */}
      {hasChildren && isSelected && (
        <div className="children-container" role="group" aria-label={`Mục con của ${node.label}`}>
          {node.children!.map((child) => (
            <OptionNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedIds={selectedIds}
              otherTexts={otherTexts}
              onToggle={onToggle}
              onOtherTextChange={onOtherTextChange}
            />
          ))}
        </div>
      )}
    </div>
  );
};
