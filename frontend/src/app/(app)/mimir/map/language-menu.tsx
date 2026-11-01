"use client";

/**
 * The language a Mimir video plays in, beside the feedback buttons. A language
 * the video is not in yet is listed but cannot be picked.
 */

import { ChevronDown, Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { VIDEO_LANGUAGE_NAMES, VIDEO_LANGUAGES, type VideoLanguage } from "@/lib/mimir/map/schema";

export function LanguageMenu({
  language,
  languages,
  disabled,
  onChoose,
}: {
  language: VideoLanguage;
  /** The languages this video can be watched in. */
  languages: VideoLanguage[];
  disabled?: boolean;
  onChoose: (language: VideoLanguage) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} aria-label={`Language: ${VIDEO_LANGUAGE_NAMES[language]}`}>
          <Languages />
          {VIDEO_LANGUAGE_NAMES[language]}
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={language} onValueChange={(l) => l !== language && onChoose(l as VideoLanguage)}>
          {VIDEO_LANGUAGES.map((l) => (
            <DropdownMenuRadioItem key={l} value={l} disabled={!languages.includes(l)}>
              {VIDEO_LANGUAGE_NAMES[l]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
