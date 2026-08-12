import type { Funcionario } from "./types";

export function currentCostCenterPrefill(employee: Funcionario | undefined) {
  if (!employee?.funcionario_id || employee.visivel_obras_control !== true) return "";
  return employee.obra_id || "";
}
