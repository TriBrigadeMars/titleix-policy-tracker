"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { MAX_COMPARISON_JURISDICTIONS } from "@/lib/search-params";
import type { Jurisdiction } from "@/types";

interface JurisdictionSelectorProps {
  jurisdictions: Jurisdiction[];
  /** Selected jurisdiction codes, in display order. */
  selected: string[];
  onChange: (selected: string[]) => void;
  maxSelections?: number;
}

export function JurisdictionSelector({
  jurisdictions,
  selected,
  onChange,
  maxSelections = MAX_COMPARISON_JURISDICTIONS,
}: JurisdictionSelectorProps) {
  const [open, setOpen] = useState(false);

  const selectedJurisdictions = selected
    .map((code) => jurisdictions.find((j) => j.code === code))
    .filter((j): j is Jurisdiction => j != null);

  const toggle = (code: string) => {
    if (selected.includes(code)) {
      onChange(selected.filter((s) => s !== code));
    } else if (selected.length < maxSelections) {
      onChange([...selected, code]);
    }
  };

  const remove = (code: string) => {
    onChange(selected.filter((s) => s !== code));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {selectedJurisdictions.map((j) => (
          <Badge key={j.code} variant="secondary" className="gap-1">
            {j.code}
            <button
              onClick={() => remove(j.code)}
              className="ml-1 rounded-full hover:bg-muted"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
          >
            {selected.length === 0
              ? "Select jurisdictions..."
              : `${selected.length} selected (max ${maxSelections})`}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0">
          <Command>
            <CommandInput placeholder="Search jurisdictions..." />
            <CommandList>
              <CommandEmpty>No jurisdiction found.</CommandEmpty>
              <CommandGroup>
                {jurisdictions.map((j) => (
                  <CommandItem
                    key={j.code}
                    value={`${j.code} ${j.name}`}
                    onSelect={() => toggle(j.code)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selected.includes(j.code) ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="font-medium">{j.code}</span>
                    <span className="ml-2 text-muted-foreground">{j.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}