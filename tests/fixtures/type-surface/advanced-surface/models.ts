export interface Product {
  id: string;
  name: string;
  price: number;
  tags?: string[];
}

export type Status = "active" | "inactive" | "pending";
