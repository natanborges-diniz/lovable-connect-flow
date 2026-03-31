import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Brain, ShieldAlert, BookOpen, ThumbsDown, Wand2 } from "lucide-react";
import { RegrasProibidasTab } from "./learning/RegrasProibidasTab";
import { ExemplosTab } from "./learning/ExemplosTab";
import { FeedbacksTab } from "./learning/FeedbacksTab";
import { PromptCompilerTab } from "./learning/PromptCompilerTab";

export function LearningCard() {
  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Brain className="h-5 w-5" /> Aprendizado da IA
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="regras" className="w-full">
          <TabsList className="w-full grid grid-cols-3 mb-4">
            <TabsTrigger value="regras" className="flex items-center gap-1 text-xs">
              <ShieldAlert className="h-3.5 w-3.5" /> Regras Proibidas
            </TabsTrigger>
            <TabsTrigger value="exemplos" className="flex items-center gap-1 text-xs">
              <BookOpen className="h-3.5 w-3.5" /> Exemplos
            </TabsTrigger>
            <TabsTrigger value="feedbacks" className="flex items-center gap-1 text-xs">
              <ThumbsDown className="h-3.5 w-3.5" /> Feedbacks
            </TabsTrigger>
          </TabsList>

          <TabsContent value="regras">
            <RegrasProibidasTab />
          </TabsContent>
          <TabsContent value="exemplos">
            <ExemplosTab />
          </TabsContent>
          <TabsContent value="feedbacks">
            <FeedbacksTab />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
