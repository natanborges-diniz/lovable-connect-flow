import AuditoriaDivergencias from "@/components/cashback/AuditoriaDivergencias";

export default function CashbackAuditoria() {
  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Cashback — Auditoria D+1</h1>
        <p className="text-sm text-muted-foreground">
          Tratamento de divergências de valor e vendas não localizadas no sistema. Toda ação é silenciosa para o cliente.
        </p>
      </div>
      <AuditoriaDivergencias />
    </div>
  );
}
