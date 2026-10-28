import {
  eyeIcon,
  presentationIcon,
  codeIcon,
} from "@excalidraw/excalidraw/components/icons";
import { MainMenu } from "@excalidraw/excalidraw/index";
import React from "react";

import { isDevEnv } from "@excalidraw/common";

import type { Theme } from "@excalidraw/element/types";

import { LanguageList } from "../app-language/LanguageList";
import { openPresenterView } from "../presenter/openPresenterView";

import { saveDebugState } from "./DebugCanvas";

/**
 * The left menu (D-242): three groups, so that it fits without scrolling and the
 * canvas background is in the second, where the look of the board is chosen.
 */
export const AppMainMenu: React.FC<{
  theme: Theme | "system";
  setTheme: (theme: Theme | "system") => void;
  refresh: () => void;
  onInsertCodePanel: () => void;
}> = React.memo((props) => {
  return (
    <MainMenu>
      <MainMenu.DefaultItems.LoadScene />
      <MainMenu.DefaultItems.InsertDocument />
      <MainMenu.Item icon={codeIcon} onSelect={() => props.onInsertCodePanel()}>
        Code panel (VS Code)
      </MainMenu.Item>
      <MainMenu.DefaultItems.SaveToActiveFile />
      <MainMenu.DefaultItems.Export />
      <MainMenu.DefaultItems.SaveAsImage />
      <MainMenu.Separator />
      <MainMenu.Item
        icon={presentationIcon}
        onSelect={() => {
          openPresenterView();
        }}
      >
        Presenter view
      </MainMenu.Item>
      <MainMenu.DefaultItems.ChangeCanvasBackground />
      <MainMenu.DefaultItems.ToggleTheme
        allowSystemTheme
        theme={props.theme}
        onSelect={props.setTheme}
      />
      <MainMenu.ItemCustom>
        <LanguageList style={{ width: "100%" }} />
      </MainMenu.ItemCustom>
      <MainMenu.DefaultItems.Preferences />
      <MainMenu.Separator />
      <MainMenu.DefaultItems.CommandPalette className="highlighted" />
      <MainMenu.DefaultItems.SearchMenu />
      <MainMenu.DefaultItems.Help />
      <MainMenu.DefaultItems.ClearCanvas />
      {isDevEnv() && (
        <MainMenu.Item
          icon={eyeIcon}
          onSelect={() => {
            if (window.visualDebug) {
              delete window.visualDebug;
              saveDebugState({ enabled: false });
            } else {
              window.visualDebug = { data: [] };
              saveDebugState({ enabled: true });
            }
            props?.refresh();
          }}
        >
          Visual Debug
        </MainMenu.Item>
      )}
    </MainMenu>
  );
});
