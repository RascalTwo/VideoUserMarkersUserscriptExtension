import { getUIFormatter } from "./formatters";
import { ObjectId } from "./helpers";
import { Collection, IPlatform, Marker } from "./types";

export function createMarkerEditors(platform: IPlatform, collection: Collection, handleMarkerUpdate: (dataChanged: boolean) => Promise<void>) {
	function startEditingMarker(marker: Marker, seconds: boolean, name: boolean, e: Event) {
		// Disable context menu
		e?.preventDefault();
		// Stop native seekbar behavior
		e?.stopImmediatePropagation();
		e?.stopPropagation();

		if (seconds && name) return editMarker(marker);
		else if (seconds) return editMarkerSeconds(marker);
		return editMarkerName(marker);
	}

	async function editMarkerSeconds(marker: Marker) {
		const formatter = getUIFormatter();
		const response = await platform!.dialog('prompt', 'Edit Time:', () => [
			formatter.multiline ? 'textarea' : 'input',
			formatter.serializeSeconds(marker.when),
		]);
		if (response === null) return;

		const seconds = formatter.deserializeSeconds(response);
		if (!seconds) return;

		marker.when = seconds;
		return handleMarkerUpdate(true);
	}

	async function editMarkerName(marker: Marker) {
		const formatter = getUIFormatter();
		const response = await platform!.dialog('prompt', 'Edit Name:', () => [
			formatter.multiline ? 'textarea' : 'input',
			formatter.serializeName(marker.title),
		]);
		if (response === null) return;

		const name = formatter.deserializeName(response);
		if (!name) return;

		marker.title = name;
		return handleMarkerUpdate(true);
	}

	async function editMarker(marker: Marker) {
		const formatter = getUIFormatter();
		const response = await platform!.dialog('prompt', 'Edit Marker:', () => [
			formatter.multiline ? 'textarea' : 'input',
			formatter.serializeAll([marker])[0],
		]);
		if (response === null) return;

		const edited = formatter.deserializeAll(response)[0];
		if (!edited) return;

		Object.assign(marker, edited, { _id: marker._id, collectionRef: marker.collectionRef });
		return handleMarkerUpdate(true);
	}

	async function editAllMarkers() {
		const formatter = getUIFormatter();
		const response = await platform!.dialog('prompt', 'Edit Serialized Markers', () => [
			'textarea',
			formatter.serializeAll(collection!.markers!),
		]);
		if (response === null) return;
		collection!.markers!.splice(
			0,
			collection!.markers!.length,
			...(formatter.deserializeAll(response) as Marker[]).map((newMarker, i) => ({
				...newMarker,
				_id: collection!.markers![i]?._id || ObjectId(),
				collectionRef: collection!.markers![i]?.collectionRef || collection!._id,
			}))
		);
		return handleMarkerUpdate(true);
	}
	return { startEditingMarker, editAllMarkers };
}