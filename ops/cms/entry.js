import {DecapCmsCore as CMS} from 'decap-cms-core';
import {ProxyBackend} from 'decap-cms-backend-proxy';
import StringWidget from 'decap-cms-widget-string';
import TextWidget from 'decap-cms-widget-text';
import NumberWidget from 'decap-cms-widget-number';
import ImageWidget from 'decap-cms-widget-image';
import FileWidget from 'decap-cms-widget-file';
import MarkdownWidget from 'decap-cms-widget-markdown';
import CodeWidget from 'decap-cms-widget-code';
import ObjectWidget from 'decap-cms-widget-object';
import image from 'decap-cms-editor-component-image';
import {es, en} from 'decap-cms-locales';

// MarkdownWidget includes both the Slate rich-text editor and Markdown mode.
// Markdown image blocks use the object control to group image, alt and title.
// Register the configured controls and the containers used by editor plugins.
CMS.registerBackend('proxy', ProxyBackend);
CMS.registerWidget([StringWidget, TextWidget, NumberWidget, ImageWidget, FileWidget, MarkdownWidget, CodeWidget, ObjectWidget].map(widget => widget.Widget()));
CMS.registerEditorComponent(image);
CMS.registerEditorComponent({id: 'code-block', label: 'Code Block', widget: 'code', type: 'code-block'});
CMS.registerLocale('es', es);
CMS.registerLocale('en', en);
window.CMS = CMS;
