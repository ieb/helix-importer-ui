/*
 * Copyright 2022 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
/* global WebImporter */

export default class PollImporter {
  constructor(cfg) {
    this.config = {
      importFileURL: `${cfg.origin}/tools/importer/import.js`,
      poll: true,
      ...cfg,
    };
    this.poll = this.config.poll;
    this.listeners = [];
    this.errorListeners = [];
    this.transformation = {};
    this.projectTransform = null;
    this.projectTransformFileURL = '';
    this.running = false;

    this.#init();
  }

  async #loadProjectTransform() {
    const $this = this;
    const loadModule = async (projectTransformFileURL) => {
      const mod = await import(projectTransformFileURL);
      if (mod.default) {
        $this.projectTransform = mod.default;
      } else {
        console.log("Transform failed to load ",projectTransformFileURL);

      }
    };

    const projectTransformFileURL = `${this.config.importFileURL}?cf=${new Date().getTime()}`;
    let body = '';
    try {
      console.debug("Loading Transform file ",projectTransformFileURL);
      const res = await fetch(projectTransformFileURL);
      body = await res.text();
      if (res.ok && body !== this.lastProjectTransformFileBody) {
        console.debug("Change or new transform file ",projectTransformFileURL);
        this.lastProjectTransformFileBody = body;
        await loadModule(projectTransformFileURL);
        this.projectTransformFileURL = projectTransformFileURL;
        // eslint-disable-next-line no-console
        console.log(`Module loaded ok: ${projectTransformFileURL}`);
        return true;
      } else {
        console.debug("No change in transform file.",res.ok);
      }
    } catch (err) {
      console.log("Module failed to load ",err);
      // ignore here, we know the file does not exist
    }
    if (body !== this.lastProjectTransformFileBody) {
      // eslint-disable-next-line no-console
      console.warn(`Importer file does not exist: ${projectTransformFileURL}`);
      this.lastProjectTransformFileBody = body;
      this.projectTransformFileURL = '';
      return true;
    }
    return false;
  }

  async #init() {
    const $this = this;
    const poll = async () => {
      if ($this.running) return;
      const hasChanged = await $this.#loadProjectTransform();
      if (hasChanged && $this.transformation.url && $this.transformation.document) {
        $this.transform();
      }
    };

    await poll();
    if (!this.projectTransformInterval && this.poll) {
      this.projectTransformInterval = setInterval(poll, 5000);
    }
  }

  async onLoad({ url, document, params }) {
    if (this.projectTransform && this.projectTransform.onLoad) {
      try {
        await this.projectTransform.onLoad({
          url,
          document,
          params,
        });
      } catch (err) {
        console.err("Failed to load transformer json",err);
        this.errorListeners.forEach((listener) => {
          listener({
            url,
            error: err,
            params,
          });
        });
        return false;
      }
    }
    return true;
  }

  async transform() {
    this.running = true;
    const {
      includeDocx, url, document, params,
    } = this.transformation;

    // eslint-disable-next-line no-console
    console.log(`Starting transformation of ${url} with import file: ${this.projectTransformFileURL || 'none (default)'}`);
    try {
      let results;
      if (includeDocx) {
        const out = await WebImporter.html2docx(
          url,
          document,
          this.projectTransform,
          params,
        );

        results = Array.isArray(out) ? out : [out];
        results.forEach((result) => {
          const { path } = result;
          result.filename = `${path}.docx`;
        });
      } else {
        const out = await WebImporter.html2md(
          url,
          document,
          this.projectTransform,
          params,
        );
        results = Array.isArray(out) ? out : [out];
      }

      this.listeners.forEach((listener) => {
        listener({
          results,
          url,
          params,
        });
      });
    } catch (err) {
      this.errorListeners.forEach((listener) => {
        listener({
          url,
          error: err,
          params,
        });
      });
    }
    this.running = false;
  }

  setTransformationInput({
    url,
    document,
    includeDocx = false,
    params,
  }) {
    this.transformation = {
      url,
      document,
      includeDocx,
      params,
    };
  }

  async setImportFileURL(importFileURL) {
    this.config.importFileURL = importFileURL;
    await this.#loadProjectTransform();
  }

  addListener(listener) {
    this.listeners.push(listener);
  }

  addErrorListener(listener) {
    this.errorListeners.push(listener);
  }
}
