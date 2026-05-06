import { useState } from "react";
import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const EDIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutos

export interface MessageActionsMenuProps {
  /** ID do autor da mensagem */
  autorId: string | null | undefined;
  /** ID do usuário logado */
  currentUserId: string | null | undefined;
  /** created_at da mensagem (ISO) */
  createdAt: string;
  /** Já está deletada? esconde menu */
  deletadaAt?: string | null;
  /** Callback ao clicar em editar */
  onEdit: () => void;
  /** Callback ao confirmar exclusão */
  onDelete: () => void | Promise<void>;
  /** Texto extra no diálogo de confirmação (ex.: aviso WhatsApp) */
  deleteWarning?: string;
  /** Força esconder (ex.: mensagens da IA, inbound, etc.) */
  forceHide?: boolean;
  /** Tom do botão para casar com a bolha */
  tone?: "light" | "dark";
}

export function isWithinEditWindow(createdAt: string) {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return false;
  return Date.now() - created <= EDIT_WINDOW_MS;
}

export function MessageActionsMenu({
  autorId,
  currentUserId,
  createdAt,
  deletadaAt,
  onEdit,
  onDelete,
  deleteWarning,
  forceHide,
  tone = "light",
}: MessageActionsMenuProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (forceHide) return null;
  if (deletadaAt) return null;
  if (!currentUserId || !autorId || autorId !== currentUserId) return null;
  if (!isWithinEditWindow(createdAt)) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={
              tone === "dark"
                ? "h-5 w-5 -mr-1 -mt-1 opacity-60 hover:opacity-100 text-current hover:bg-white/15"
                : "h-5 w-5 -mr-1 -mt-1 opacity-60 hover:opacity-100"
            }
            aria-label="Opções da mensagem"
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={onEdit} className="text-xs">
            <Pencil className="h-3.5 w-3.5 mr-2" /> Editar
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setConfirmOpen(true)}
            className="text-xs text-destructive focus:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta mensagem?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteWarning ||
                "A mensagem ficará marcada como apagada no histórico interno. Essa ação não pode ser desfeita."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await onDelete();
                setConfirmOpen(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
