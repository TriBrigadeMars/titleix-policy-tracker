"use client";

import { useState, useEffect } from "react";
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
import type { Jurisdiction } from "@/types";

interface JurisdictionSelectorProps {
  selected: string[];
  onChange: (selected: string[]) => void;
  maxSelections?: number;
}

export function JurisdictionSelector({
  selected,
  onChange,
  maxSelections = 8,
}: JurisdictionSelectorProps) {
  const [open, setOpen] = useState(false);
  const [jurisdictions, setJurisdictions] = useState<Jurisdiction[]>([]);

  useEffect(() => {
    fetch("/api/jurisdictions")
      .then((res) => res.json())
      .then(setJurisdictions)
      .catch(console.error);
  }, []);

  const selectedJurisdictions = jurisdictions.filter((j) =>
    selected.includes(j.id)
  );

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else if (selected.length < maxSelections) {
      onChange([...selected, id]);
    }
  };

  const remove = (id: string) => {
    onChange(selected.filter((s) => s !== id));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {selectedJurisdictions.map((j) => (
          <Badge key={j.id} variant="secondary" className="gap-1">
            {j.code}
            <button
              onClick={() => remove(j.id)}
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
                    key={j.id}
                    value={`${j.code} ${j.name}`}
                    onSelect={() => toggle(j.id)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selected.includes(j.id) ? "opacity-100" : "opacity-0"
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