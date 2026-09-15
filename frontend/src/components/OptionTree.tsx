import React from "react";
import { FormOption } from "../types/schema";
import { OptionNode } from "./OptionNode";

interface OptionTreeProps {
  options: FormOption[];
  selectedIds: Set<string>;
  otherTexts: Record<string, string>;
  onToggle: (node: FormOption, isChecked: boolean) => void;
  onOtherTextChange: (nodeId: string, text: string) => void;
}

export const OptionTree: React.FC<OptionTreeProps> = ({
  options,
  selectedIds,
  otherTexts,
  onToggle,
  onOtherTextChange,
}) => {
  return (
    <div className="options-list" role="group" aria-label="Danh mục giải phẫu bệnh">
      {options.map((opt) => (
        <OptionNode
          key={opt.id}
          node={opt}
          depth={0}
          selectedIds={selectedIds}
          otherTexts={otherTexts}
          onToggle={onToggle}
          onOtherTextChange={onOtherTextChange}
        />
      ))}
    </div>
  );
};
