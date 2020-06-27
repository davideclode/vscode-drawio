import {
	ConservativeFlattenedEntryParser,
	FlattenToDictionary,
	JSONValue,
} from "@hediet/json-to-dictionary";

declare const Draw: any;
declare const log: any;
declare const mxCellHighlight: any;
declare const mxEvent: any;
declare const mxUtils: {
	isNode(node: any): node is HTMLElement;
	createXmlDocument(): XMLDocument;
};

function sendEvent(data: CustomDrawioEvent) {
	window.opener.postMessage(JSON.stringify(data), "*");
}

Draw.loadPlugin(function (ui: any) {
	sendEvent({ event: "pluginLoaded" });

	let interceptNodeClick = false;
	const graph = ui.editor.graph;
	const highlight = new mxCellHighlight(graph, "#00ff00", 8);

	const model: { setStyle(cell: unknown, style: string): void } = graph.model;
	let activeCell: { style: string } | undefined = undefined;

	graph.addListener(mxEvent.DOUBLE_CLICK, function (sender: any, evt: any) {
		if (!interceptNodeClick) {
			return;
		}

		var cell: any | null = evt.getProperty("cell");
		if (cell != null) {
			const label = getLabelTextOfCell(cell);
			if (!label.match(/^#([a-zA-Z0-9_]+)/)) {
				return;
			}

			const data = getLinkedData(cell);
			sendEvent({ event: "nodeSelected", label, linkedData: data });
			evt.consume();
		}
	});

	function getLabelTextOfCell(cell: any): string {
		const labelHtml = graph.getLabel(cell) as string;
		const el = document.createElement("html");
		el.innerHTML = labelHtml; // label can be html
		return el.innerText;
	}

	const selectionModel = graph.getSelectionModel();
	selectionModel.addListener(mxEvent.CHANGE, (sender: any, evt: any) => {
		// selection has changed
		const cells: any[] = selectionModel.cells; // array of cells
		if (cells.length >= 1) {
			const selectedCell = cells[0];
			activeCell = selectedCell;
			(window as any).hediet_Cell = selectedCell;
		} else {
			activeCell = undefined;
		}
	});

	const prefix = "hedietLinkedDataV1";
	const flattener = new FlattenToDictionary({
		parser: new ConservativeFlattenedEntryParser({
			prefix,
			separator: "_",
		}),
	});

	function getLinkedData(cell: { value: unknown }) {
		if (!mxUtils.isNode(cell.value)) {
			return undefined;
		}
		const kvs = [...(cell.value.attributes as any)]
			.filter((a) => a.name.startsWith(prefix))
			.map((a) => [a.name, a.value]);

		const r: Record<string, string> = {};
		for (const [k, v] of kvs) {
			r[k] = v;
		}
		return flattener.unflatten(r);
	}

	function setLinkedData(cell: any, linkedData: JSONValue) {
		let newNode: HTMLElement;
		if (!mxUtils.isNode(cell.value)) {
			const doc = mxUtils.createXmlDocument();
			const obj = doc.createElement("object");
			obj.setAttribute("label", cell.value || "");
			newNode = obj;
		} else {
			newNode = cell.value.cloneNode(true);
		}

		for (const a of newNode.attributes as any) {
			if (a.name.startsWith(prefix)) {
				newNode.attributes.removeNamedItem(a.name);
			}
		}

		const kvp = flattener.flatten(linkedData);
		for (const [k, v] of Object.entries(kvp)) {
			newNode.setAttribute(k, v);
		}

		cell.setValue(newNode);
	}

	window.addEventListener("message", (evt) => {
		if (evt.source !== window.opener) {
			return;
		}

		console.log(evt);
		const data = JSON.parse(evt.data) as CustomDrawioAction;

		switch (data.action) {
			case "setNodeSelectionEnabled": {
				interceptNodeClick = data.enabled;
				break;
			}
			case "linkSelectedNodeWithData": {
				if (activeCell !== undefined) {
					log("Set linkedData to " + data.linkedData);
					setLinkedData(activeCell, data.linkedData);
					highlight.highlight(graph.view.getState(activeCell));
					setTimeout(() => {
						highlight.highlight(null);
					}, 500);
				}
				break;
			}
			case "getVertices": {
				const vertices = Object.values(graph.model.cells)
					.filter((c) => graph.model.isVertex(c))
					.map((c: any) => ({ id: c.id, label: graph.getLabel(c) }));
				sendEvent({
					event: "getVertices",
					message: data,
					vertices: vertices,
				});
				break;
			}
			case "updateVertices": {
				const vertices = data.verticesToUpdate;

				graph.model.beginUpdate();
				try {
					for (const v of vertices) {
						const c = graph.model.cells[v.id];
						if (!c) {
							log(`Unknown cell "${v.id}"!`);
							continue;
						}
						if (graph.getLabel(c) !== v.label) {
							graph.model.setValue(c, v.label);
						}
					}
				} finally {
					graph.model.endUpdate();
				}
				break;
			}
			case "addVertices": {
				// why is this called twice?
				log("add vertices is being called");
				const vertices = data.vertices;

				graph.model.beginUpdate();
				try {
					let i = 0;
					for (const v of vertices) {
						graph.insertVertex(
							undefined,
							null,
							v.label,
							i * 120,
							0,
							100,
							50,
							"rectangle"
						);
						i++;
					}
				} finally {
					graph.model.endUpdate();
				}
				break;
			}
			default: {
				return;
			}
		}

		evt.preventDefault();
		evt.stopPropagation();
	});

	(window as any).hediet_DbgUi = ui;
});
